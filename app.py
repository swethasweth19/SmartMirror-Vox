"""
SmartMirror-Vox — Pure Python Backend & Server
Runs the Smart Mirror on Flask with full Groq LLM integration,
multilingual TTS streaming, JioSaavn direct audio decryption (DES),
and live static frontend serving.

Usage:
    python app.py
"""

import os
import re
import json
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Cryptography for JioSaavn audio stream decryption
try:
    from Crypto.Cipher import DES
    from Crypto.Util.Padding import unpad
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

TEXT_MODELS = [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile"
]

VISION_MODELS = [
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview"
]

# DES Decryption Key for JioSaavn
SAAVN_DES_KEY = b"38346591"

TOP_HITS_BY_LANG = {
    "tamil": [
        "Arabic Kuthu - Halamithi Habibo",
        "Hukum - Thalaivar Alappara",
        "Naa Ready Leo",
        "Kaavaalaa Jailer",
        "Rowdy Baby Maari 2",
        "Vaathi Coming Master"
    ],
    "telugu": [
        "Samajavaragamana Ala Vaikunthapurramuloo",
        "Pushpa Pushpa Telugu",
        "Oo Antava Mawa Pushpa",
        "Butta Bomma",
        "Naatu Naatu RRR"
    ],
    "kannada": [
        "Belakina Kavithe",
        "Ra Ra Rakkamma Vikrant Rona",
        "Singara Siriye Kantara",
        "Tagaru Banthu Tagaru",
        "Dheera Dheera KGF"
    ],
    "hindi": [
        "Kesariya Brahmastra",
        "Tum Hi Ho Aashiqui 2",
        "Apna Bana Le Bhediya",
        "Chaleya Jawan",
        "Raataan Lambiyan Shershaah"
    ],
    "english": [
        "Believer Imagine Dragons",
        "Shape of You Ed Sheeran",
        "Blinding Lights The Weeknd",
        "Levitating Dua Lipa",
        "Stay The Kid LAROI Justin Bieber"
    ]
}


def decrypt_saavn_url(encrypted_url: str) -> str:
    """Decrypts Saavn DES ECB encrypted media URL."""
    if not HAS_CRYPTO or not encrypted_url:
        return ""
    try:
        cipher = DES.new(SAAVN_DES_KEY, DES.MODE_ECB)
        enc_bytes = base64.b64decode(encrypted_url)
        decrypted = unpad(cipher.decrypt(enc_bytes), DES.block_size)
        return decrypted.decode("utf-8")
    except Exception:
        return ""


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def static_files(path):
    if os.path.exists(path):
        return send_from_directory(".", path)
    return send_from_directory(".", "index.html")


# ==================== /api/chat ====================
@app.route("/api/chat", methods=["POST", "OPTIONS"])
def api_chat():
    if request.method == "OPTIONS":
        return "", 200

    api_key = GROQ_API_KEY or os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return jsonify({"error": {"message": "GROQ_API_KEY is not configured in server environment."}}), 500

    body = request.get_json(silent=True) or {}
    is_vision = "image_url" in json.dumps(body)
    pool = VISION_MODELS if is_vision else TEXT_MODELS
    requested = body.get("model")

    models_to_try = []
    if requested and requested in pool:
        models_to_try.append(requested)
        models_to_try.extend([m for m in pool if m != requested])
    else:
        models_to_try = list(pool)

    last_status = 500
    last_data = {"error": "Failed to reach AI service"}

    for model in models_to_try:
        payload = dict(body)
        payload["model"] = model
        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json=payload,
                timeout=10
            )
            last_status = resp.status_code
            last_data = resp.json()
            if resp.ok:
                return jsonify(last_data), 200
            if resp.status_code in (429, 404, 400):
                continue
            break
        except Exception as e:
            last_data = {"error": str(e)}

    return jsonify(last_data), last_status


# ==================== /api/tts ====================
@app.route("/api/tts", methods=["GET", "OPTIONS"])
def api_tts():
    if request.method == "OPTIONS":
        return "", 200

    text = request.args.get("text") or request.args.get("q") or ""
    lang = request.args.get("lang") or request.args.get("tl") or "en"
    text = text.strip()[:200]

    if not text:
        return jsonify({"error": "Text parameter is required"}), 400

    google_tts_url = (
        f"https://translate.google.com/translate_tts?ie=UTF-8"
        f"&tl={lang}&client=tw-ob&q={requests.utils.quote(text)}"
    )

    try:
        r = requests.get(
            google_tts_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://translate.google.com/"
            },
            timeout=5
        )
        if not r.ok:
            return jsonify({"error": "TTS upstream error"}), r.status_code

        return Response(r.content, mimetype="audio/mpeg", headers={
            "Cache-Control": "public, max-age=86400"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==================== /api/music ====================
@app.route("/api/music", methods=["GET", "POST", "OPTIONS"])
@app.route("/api/youtube", methods=["GET", "POST", "OPTIONS"])
def api_music():
    if request.method == "OPTIONS":
        return "", 200

    q = (request.args.get("q") or request.args.get("song") or "").strip()
    lang = (request.args.get("lang") or "").lower().strip()

    if not q and lang in TOP_HITS_BY_LANG:
        hits = TOP_HITS_BY_LANG[lang]
        import random
        q = random.choice(hits)

    if not q:
        q = "trending songs"

    search_url = (
        f"https://www.jiosaavn.com/api.php?__call=search.getResults"
        f"&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&p=1&q={requests.utils.quote(q)}"
    )

    try:
        r = requests.get(search_url, timeout=5)
        data = r.json()
        results = data.get("results") or []
        for song in results:
            enc_url = song.get("encrypted_media_url")
            if enc_url:
                stream_url = decrypt_saavn_url(enc_url)
                if stream_url:
                    # Upgrade bitrate to 320kbps or 160kbps if applicable
                    stream_url = stream_url.replace("_96.mp4", "_320.mp4").replace("_96.mp3", "_320.mp3")
                    return jsonify({
                        "title": song.get("song", q),
                        "artist": song.get("primary_artists", ""),
                        "audioUrl": stream_url,
                        "image": song.get("image", "")
                    }), 200

        # Fallback to direct radio streams if search has no decryptable item
        return jsonify({
            "title": q.title(),
            "artist": "Smart Mirror Music",
            "audioUrl": "https://stream.zeno.fm/0r0xa792kwzuv"
        }), 200
    except Exception as e:
        return jsonify({
            "title": q.title(),
            "artist": "Smart Mirror Music",
            "audioUrl": "https://stream.zeno.fm/0r0xa792kwzuv",
            "error": str(e)
        }), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 60)
    print(f"✨ SMARTMIRROR-VOX PYTHON BACKEND RUNNING")
    print(f"✨ Server URL: http://localhost:{port}")
    print(f"✨ Python Version: 3.11 | Framework: Flask")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=True)
