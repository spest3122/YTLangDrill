let currentVideoId = "";
let pins = {};
let loopA = null;
let loopB = null;
let isRepeatEnabled = false;
let lastTime = 0;
let videoElement = null;
let jumpCooldown = 0;

function getVideoId() {
    return new URLSearchParams(window.location.search).get("v");
}

function loadPins() {
    currentVideoId = getVideoId();
    if (!currentVideoId) return;

    chrome.storage.local.get([currentVideoId], (result) => {
        const data = result[currentVideoId] || {};

        if (data.pins) {
            pins = data.pins;
            loopA = data.loopA;
            loopB = data.loopB;
        } else {
            pins = {};
            for (const key in data) {
                if (typeof data[key] === "number") {
                    pins[key] = { time: data[key], skip: false };
                } else {
                    pins[key] = data[key];
                }
            }
            loopA = null;
            loopB = null;
        }

        saveData();
        updateUI();
    });
}

function saveData(callback) {
    chrome.storage.local.set({ [currentVideoId]: { pins, loopA, loopB } }, callback);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
    return `${m}:${s}`;
}

function setupVideoListener(video) {
    if (video !== videoElement) {
        if (videoElement) {
            videoElement.removeEventListener("timeupdate", handleTimeUpdate);
        }
        videoElement = video;
        videoElement.addEventListener("timeupdate", handleTimeUpdate);
    }
}

// --- BUG FIX: Unified Engine ---
function handleTimeUpdate(e) {
    const video = e.target;
    const currentTime = video.currentTime;

    if (Math.abs(currentTime - lastTime) > 1.5) {
        lastTime = currentTime;
        return;
    }

    if (Date.now() < jumpCooldown) {
        lastTime = currentTime;
        return;
    }

    // 1. --- SKIP LOGIC (Always Runs First) ---
    const sortedPins = Object.values(pins).sort((a, b) => a.time - b.time);
    const boundaries = [
        { time: 0, skip: false },
        ...sortedPins,
        { time: video.duration - 0.5, skip: false },
    ];

    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];

        if (currentTime >= start.time && currentTime < end.time && end.skip) {
            video.currentTime = end.time;
            lastTime = end.time;
            jumpCooldown = Date.now() + 1000;
            showToast(`⏭️ Skipped segment`);
            return; // Exit out so we don't accidentally process a repeat jump in the exact same millisecond
        }
    }

    // 2. --- A-B REPEAT LOGIC (Runs Second) ---
    if (isRepeatEnabled) {
        let startBoundary = 0;
        let endBoundary = video.duration || 999999;

        if (loopA && pins[loopA]) startBoundary = pins[loopA].time;
        if (loopB && pins[loopB]) endBoundary = pins[loopB].time;

        if (startBoundary >= endBoundary) {
            lastTime = currentTime;
            return;
        }

        if (lastTime >= startBoundary && lastTime < endBoundary && currentTime >= endBoundary) {
            video.currentTime = startBoundary;
            lastTime = startBoundary;
            jumpCooldown = Date.now() + 1000;
            showToast(`🔁 Looped back to ${loopA ? "A" : "Start"}`);
            return;
        }
    }

    lastTime = currentTime;
}

function updateUI() {
    const video = document.querySelector("video");
    if (!video || !video.duration) {
        setTimeout(updateUI, 500);
        return;
    }

    setupVideoListener(video);
    renderMarkers(video);
    renderPanel();
}

function renderMarkers(video) {
    const progressList = document.querySelector(".ytp-progress-list");
    if (!progressList) return;

    document.querySelectorAll(".yt-pin-marker").forEach((el) => el.remove());

    for (const [key, pinData] of Object.entries(pins)) {
        const percent = (pinData.time / video.duration) * 100;

        const marker = document.createElement("div");
        marker.className = "yt-pin-marker";
        marker.style.left = `${percent}%`;
        marker.setAttribute("data-key", key);

        if (pinData.skip) marker.classList.add("skipped");
        if (key === loopA && isRepeatEnabled) marker.style.backgroundColor = "#4caf50";
        if (key === loopB && isRepeatEnabled) marker.style.backgroundColor = "#2196f3";

        marker.addEventListener("click", (e) => {
            e.stopPropagation();
            video.currentTime = pinData.time;
        });

        progressList.appendChild(marker);
    }
}

function renderPanel() {
    let panel = document.getElementById("yt-pin-panel");
    const player = document.getElementById("movie_player") || document.body;

    if (!panel) {
        panel = document.createElement("div");
        panel.id = "yt-pin-panel";
        player.appendChild(panel);
    }

    if (Object.keys(pins).length === 0 && !isRepeatEnabled) {
        panel.style.display = "none";
        return;
    }

    panel.style.display = "block";

    panel.innerHTML = `
    <div class="yt-pin-header">
      <span>📍 Pinned Locations</span>
      <div class="yt-pin-actions">
        <button id="yt-pin-repeat-btn" class="${isRepeatEnabled ? "active" : ""}">
          🔁 ${isRepeatEnabled ? "ON" : "OFF"}
        </button>
        <button id="yt-pin-clear-btn">🗑️ Clear</button>
      </div>
    </div>
  `;

    document.getElementById("yt-pin-repeat-btn").addEventListener("click", (e) => {
        isRepeatEnabled = !isRepeatEnabled;
        showToast(`Repeat turned ${isRepeatEnabled ? "ON" : "OFF"}`);
        updateUI();
    });

    document.getElementById("yt-pin-clear-btn").addEventListener("click", () => {
        pins = {};
        loopA = null;
        loopB = null;
        chrome.storage.local.remove([currentVideoId], () => {
            showToast("All pins cleared");
            updateUI();
        });
    });

    const list = document.createElement("ul");
    list.className = "yt-pin-list";

    const sortedPins = Object.entries(pins).sort((a, b) => a[1].time - b[1].time);

    for (const [key, pinData] of sortedPins) {
        const item = document.createElement("li");
        item.className = "yt-pin-item";

        const leftSide = document.createElement("div");
        leftSide.className = "yt-pin-item-left";
        leftSide.innerHTML = `<strong>${key}</strong> <span class="time">${formatTime(pinData.time)}</span>`;

        const rightSide = document.createElement("div");
        rightSide.className = "yt-pin-item-right";

        const aBtn = document.createElement("button");
        aBtn.className = `yt-pin-ab-btn ${loopA === key ? "active-a" : ""}`;
        aBtn.innerText = "A";
        aBtn.title = "Set as Loop Start";
        aBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (loopA === key) loopA = null;
            else {
                loopA = key;
                if (loopB && pins[loopA].time >= pins[loopB].time) loopB = null;
            }
            saveData(updateUI);
        });

        const bBtn = document.createElement("button");
        bBtn.className = `yt-pin-ab-btn ${loopB === key ? "active-b" : ""}`;
        bBtn.innerText = "B";
        bBtn.title = "Set as Loop End";
        bBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (loopB === key) loopB = null;
            else {
                loopB = key;
                if (loopA && pins[loopB].time <= pins[loopA].time) loopA = null;
            }
            saveData(updateUI);
        });

        const skipBtn = document.createElement("button");
        skipBtn.className = `yt-pin-skip-btn ${pinData.skip ? "active" : ""}`;
        skipBtn.innerText = "⏭️";
        skipBtn.title = "Skip this segment";
        skipBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            pins[key].skip = !pins[key].skip;
            saveData(updateUI);
        });

        rightSide.appendChild(aBtn);
        rightSide.appendChild(bBtn);
        rightSide.appendChild(skipBtn);

        item.appendChild(leftSide);
        item.appendChild(rightSide);

        item.addEventListener("click", () => {
            if (videoElement) {
                videoElement.currentTime = pinData.time;
                showToast(`Jumped to Pin ${key}`);
            }
        });

        list.appendChild(item);
    }

    panel.appendChild(list);
}

document.addEventListener("yt-navigate-finish", loadPins);
window.addEventListener("load", loadPins);

document.addEventListener(
    "keydown",
    (e) => {
        const target = e.target.tagName;
        if (target === "INPUT" || target === "TEXTAREA" || e.target.isContentEditable) return;

        const video = document.querySelector("video");
        if (!video) return;

        if (e.shiftKey && e.code === "KeyC") {
            e.preventDefault();
            e.stopImmediatePropagation();
            pins = {};
            loopA = null;
            loopB = null;
            chrome.storage.local.remove([currentVideoId], () => {
                showToast("All pins cleared");
                updateUI();
            });
            return;
        }

        if (e.shiftKey && e.code === "KeyR") {
            e.preventDefault();
            e.stopImmediatePropagation();
            isRepeatEnabled = !isRepeatEnabled;
            showToast(`Repeat turned ${isRepeatEnabled ? "ON" : "OFF"}`);
            updateUI();
            return;
        }

        let numKey = null;
        if (e.code && e.code.startsWith("Digit")) {
            numKey = e.code.replace("Digit", "");
        } else if (e.code && e.code.startsWith("Numpad")) {
            numKey = e.code.replace("Numpad", "");
        }

        if (!numKey) return;

        if (e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pins[numKey] = { time: video.currentTime, skip: false };
            saveData(() => {
                showToast(`Pin ${numKey} set at ${formatTime(video.currentTime)}`);
                updateUI();
            });
        } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            if (pins[numKey] !== undefined) {
                e.preventDefault();
                e.stopImmediatePropagation();
                video.currentTime = pins[numKey].time;
                showToast(`Jumped to Pin ${numKey}`);
            }
        }
    },
    true,
);

function showToast(message) {
    let toast = document.getElementById("yt-pin-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "yt-pin-toast";
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add("show");
    clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 2000);
}
