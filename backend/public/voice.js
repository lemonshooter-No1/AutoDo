const activeSessions = new Map();
let pressedButton = null;
const VOICE_ENDPOINT = "/api/audio/transcribe";
const DEFAULT_MODEL = "FunAudioLLM/SenseVoiceSmall";

function getTargetElement(button) {
  const targetId = button?.dataset?.voiceTarget;
  if (!targetId) return null;
  return document.getElementById(targetId);
}

function setButtonState(button, state) {
  if (!button) return;
  const base = button.dataset.voiceLabel || "按住说话";
  if (state === "recording") {
    button.classList.add("recording");
    button.textContent = "松开发送";
  } else if (state === "busy") {
    button.classList.remove("recording");
    button.textContent = "识别中…";
    button.disabled = true;
  } else {
    button.classList.remove("recording");
    button.disabled = false;
    button.textContent = base;
  }
}

function insertTextAtCursor(target, text) {
  if (!target) return;
  const insert = text.trim();
  if (!insert) return;

  const current = target.value || "";
  const needsSpace = current && !/\s$/.test(current) && !/^\s/.test(insert);

  if (typeof target.selectionStart === "number" && typeof target.selectionEnd === "number") {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const prefix = current.slice(0, start);
    const suffix = current.slice(end);
    const joiner = prefix && !/\s$/.test(prefix) && !/^\s/.test(insert) ? " " : "";
    target.value = `${prefix}${joiner}${insert}${suffix}`;
    const nextPos = (prefix + joiner + insert).length;
    target.setSelectionRange(nextPos, nextPos);
  } else {
    target.value = needsSpace ? `${current} ${insert}` : `${current}${insert}`;
  }

  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.focus();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("语音读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function transcribeBlob(blob) {
  const dataUrl = await blobToDataUrl(blob);
  const payload = {
    model: DEFAULT_MODEL,
    mime_type: blob.type || "audio/webm",
    audio_base64: dataUrl,
  };

  const res = await fetch(VOICE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || "语音识别失败");
  }
  return data.text || data.transcript || data.result || "";
}

async function startRecording(button) {
  if (activeSessions.has(button)) return;
  const target = getTargetElement(button);
  if (!target) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持语音录制");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];

  const session = { stream, recorder, button, target, stopped: false };
  activeSessions.set(button, session);
  setButtonState(button, "recording");

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    if (session.stopped) return;
    session.stopped = true;
    activeSessions.delete(button);
    stream.getTracks().forEach((track) => track.stop());
    setButtonState(button, "busy");
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const text = await transcribeBlob(blob);
      if (text) {
        insertTextAtCursor(target, text);
      }
    } catch (error) {
      console.error(error);
      window.toast?.(error.message || "语音识别失败");
    } finally {
      setButtonState(button, "idle");
    }
  };

  recorder.start();
}

function stopRecording(button) {
  if (!button) return;
  const session = activeSessions.get(button);
  pressedButton = null;
  if (!session || session.stopped) return;
  session.stopped = true;
  if (session.recorder.state !== "inactive") {
    session.recorder.stop();
  }
}

function handlePressStart(event) {
  const button = event.target.closest("[data-voice-target]");
  if (!button) return;
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  pressedButton = button;
  startRecording(button).catch((error) => {
    pressedButton = null;
    window.toast?.(error.message || "无法开始录音");
    setButtonState(button, "idle");
  });
}

function handlePressEnd() {
  stopRecording(pressedButton);
}

document.addEventListener("pointerdown", handlePressStart, true);
document.addEventListener("pointerup", handlePressEnd, true);
document.addEventListener("pointercancel", handlePressEnd, true);
document.addEventListener("pointerleave", handlePressEnd, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    for (const button of activeSessions.keys()) {
      stopRecording(button);
    }
  }
});

window.AutoDoVoice = {
  bindButtonState(button) {
    setButtonState(button, "idle");
  },
};
