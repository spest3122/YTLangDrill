let currentVideoId = "";
let pins = {};
let isRepeatEnabled = false;
let lastTime = 0;
let videoElement = null;
let jumpCooldown = 0;

// Get the unique YouTube video ID from the URL
function getVideoId() {
    return new URLSearchParams(window.location.search).get("v");
}

// Load pins from Chrome storage and migrate old data if needed
function loadPins() {
    currentVideoId = getVideoId();
    if (!currentVideoId) return;

    chrome.storage.local.get([currentVideoId], (result) => {
        const rawPins = result[currentVideoId] || {};
        pins = {};

        // Data Migration
        for (const key in rawPins) {
            if (typeof rawPins[key] === "number") {
                pins[key] = { time: rawPins[key], skip: false };
            } else {
                pins[key] = rawPins[key];
            }
        }

        chrome.storage.local.set({ [currentVideoId]: pins });
        updateUI();
    });
}

// Format seconds into MM:SS
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
    return `${m}:${s}`;
}

// --- The Unified Video Engine (Handles Repeat & Skip Together) ---
function setupVideoListener(video) {
    if (video !== videoElement) {
        if (videoElement) {
            videoElement.removeEventListener("timeupdate", handleTimeUpdate);
        }
        videoElement = video;
        videoElement.addEventListener("timeupdate", handleTimeUpdate);
    }
}

function handleTimeUpdate(e) {
    const video = e.target;
    const currentTime = video.currentTime;

    // 1. Detect manual seek from the user
    if (Math.abs(currentTime - lastTime) > 1.5) {
        lastTime = currentTime;
        return;
    }

    // 2. Cooldown check to prevent double-jumping from browser keyframes
    if (Date.now() < jumpCooldown) {
        lastTime = currentTime;
        return;
    }

    // 3. Define all boundaries: Start (0) + sorted pins + End of video
    const sortedPins = Object.values(pins).sort((a, b) => a.time - b.time);
    const boundaries = [
        { time: 0, skip: false },
        ...sortedPins,
        { time: video.duration - 0.5, skip: false },
    ];

    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];

        // --- SKIP LOGIC ---
        // If the playhead is currently inside a segment that is marked to be skipped
        if (currentTime >= start.time && currentTime < end.time && end.skip) {
            video.currentTime = end.time;
            lastTime = end.time;
            jumpCooldown = Date.now() + 1000;
            showToast(`⏭️ Skipped segment`);
            return; // Exit out so we don't process repeat on the same tick
        }

        // --- REPEAT LOGIC ---
        // If Repeat is ON, and we just crossed the end of a segment
        if (isRepeatEnabled) {
            if (lastTime >= start.time && lastTime < end.time && currentTime >= end.time) {
                video.currentTime = start.time;
                lastTime = start.time;
                jumpCooldown = Date.now() + 1000;
                showToast(`🔁 Looping segment`);
                return;
            }
        }
    }

    lastTime = currentTime;
}

// --- Visual UI Updaters ---
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

        // UI Update: Red marker applies to skip even if repeat is ON
        if (pinData.skip) {
            marker.classList.add("skipped");
        }

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
        e.target.innerText = `🔁 ${isRepeatEnabled ? "ON" : "OFF"}`;
        e.target.className = isRepeatEnabled ? "active" : "";
        showToast(`Repeat turned ${isRepeatEnabled ? "ON" : "OFF"}`);
        updateUI();
    });

    document.getElementById("yt-pin-clear-btn").addEventListener("click", () => {
        pins = {};
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

        const skipBtn = document.createElement("button");
        skipBtn.className = `yt-pin-skip-btn ${pinData.skip ? "active" : ""}`;
        skipBtn.innerText = "⏭️ Skip";

        skipBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            pins[key].skip = !pins[key].skip;
            chrome.storage.local.set({ [currentVideoId]: pins }, () => {
                updateUI();
            });
        });

        item.appendChild(leftSide);
        item.appendChild(skipBtn);

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

// Listen for YouTube's specific page navigation event
document.addEventListener("yt-navigate-finish", loadPins);
window.addEventListener("load", loadPins);

// Intercept Keypresses
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

            chrome.storage.local.set({ [currentVideoId]: pins }, () => {
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
