# SmartMirror-Vox: Voice-Interactive Smart Mirror with n8n Workflow Automation

An AI-driven, voice-controlled smart mirror interface integrating **n8n Workflow Automation**, **Large Language Models (Groq LPUs / Qwen)**, **Computer Vision**, and **Real-Time Environmental Telemetry**.

---

## 🏛️ System Architecture

```text
+-----------------------------------------------------------------------------------------+
|                                    SMART MIRROR HARDWARE                                |
|   Microphone (Continuous STT)  |  Webcam (Vision Stream)  |  Display Screen (Mirror UI)  |
+-----------------------------------------------------------------------------------------+
                                             |
                                    [Hands-Free Voice]
                                             v
+-----------------------------------------------------------------------------------------+
|                               FRONTEND INTERFACE LAYER (Vox)                            |
|  - Web Speech Recognition (Interim & Continuous wake-word pipeline)                     |
|  - SpeechSynthesis TTS Audio Feedback                                                  |
|  - Live Environmental Telemetry (wttr.in Weather API, Google News RSS, Local Clock)      |
+-----------------------------------------------------------------------------------------+
                                             |
                                 [HTTP POST Webhook JSON]
                                             v
+-----------------------------------------------------------------------------------------+
|                          BACKEND: n8n WORKFLOW AUTOMATION PIPELINE                      |
|                                                                                         |
|   [ Webhook: POST /webhook/mirror-agent ]                                               |
|                    |                                                                    |
|                    v                                                                    |
|   [ Node: Intent Classifier & Normalizer ]                                              |
|                    |                                                                    |
|                    v                                                                    |
|   [ Node: Agentic Switch Router ]                                                       |
|         ├──> Output 1: Language State Handler                                           |
|         ├──> Output 2: Image Generation Dispatcher                                      |
|         ├──> Output 3: Media & Music Controller                                         |
|         ├──> Output 4: Outfit Vision Analysis (VLM Node)                                |
|         └──> Output 5: Multilingual LLM Reasoning Node (Groq LPU Engine)                |
|                                                                                         |
|                    |                                                                    |
|                    v                                                                    |
|   [ Node: Respond to Smart Mirror Client (Unified JSON Response) ]                      |
+-----------------------------------------------------------------------------------------+
                                             |
                                 [Structured JSON Response]
                                             v
+-----------------------------------------------------------------------------------------+
|                            MIRROR UI VISUAL & AUDIO FEEDBACK                            |
|   Real-time voice speech output, animated visualizer, outfit critique, and status cards |
+-----------------------------------------------------------------------------------------+
```

---

## 🔬 Research & Technical Features

1. **n8n Workflow Orchestration (`workflow_smartmirror_n8n.json`)**:
   - Uses an automated event-driven graph in **n8n** to classify user intents, route requests, manage conversation context, and execute external AI models.
   - Includes webhook ingestion, normalization, routing, and response formatting.

2. **Zero-Touch Hands-Free Voice Control**:
   - Continuous acoustic listening for the wake word (`"Jarvis"`).
   - Instant speech interruption (*"Stop"*, *"Quiet"*, *"Bas"*, *"Nillsu"*).
   - Multilingual voice recognition with dynamic locale switching (English, Hindi, Kannada, Telugu, Tamil).

3. **Mirror Camera Vision & Outfit Analysis**:
   - Direct camera-frame capture for personal styling and fashion assessment.
   - Correlates wardrobe suggestions with live weather telemetry (e.g., umbrella for rain, sunglasses for UV index).

4. **Live Telemetry & Dashboard**:
   - Real-time weather and geo-location resolution.
   - Live syndicated news headlines via RSS integration.
   - Digital HUD mirror overlay with clock and audio playback visualizer.

---

## 📂 Repository Structure

- `workflow_smartmirror_n8n.json` — **Official n8n Workflow Automation File** (Importable into n8n).
- `frontend/`
  - `index.html` — Clean mirror UI with camera reflection, HUD widgets, and voice status.
  - `app.js` — Client-side voice loop, wake word detector, and n8n/AI communication pipeline.
  - `style.css` — High-contrast dark mirror styling optimized for two-way acrylic glass.
- `api/chat.js` — Serverless proxy for cloud deployment (e.g., Vercel).
- `vercel.json` — Cloud deployment configuration.

---

## 🚀 Running the Project

### 1. n8n Workflow Setup
1. Launch n8n locally (`npx n8n` or desktop app) at `http://localhost:5678`.
2. Click **Menu (⋮) -> Import from File** and select `workflow_smartmirror_n8n.json`.
3. Set your Groq API key in the HTTP Request nodes (`Outfit Vision Analysis` and `Multilingual Reasoning Engine`).
4. Toggle the workflow to **Active**.

### 2. Launch the Mirror Client
You can serve the `frontend/` directory using any local web server:
```bash
python -m http.server 8080 --directory frontend
```
Open `http://localhost:8080` in Google Chrome or Microsoft Edge.

---

## 📜 Citation / Reference
If citing this project in academic research or technical publications:
> *SmartMirror-Vox: A Zero-Touch Smart Mirror System Leveraging n8n Workflow Pipelines and Multimodal Large Language Models.*
