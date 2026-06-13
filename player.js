const CONFIG = {
  BASE_API: "/api/proxy",
  REQUIRE_DELTA_KEY: false,
  DELTA_ACCESS_KEY: "delta-access-key",
  DELTA_KEY_EXPIRATION: "delta-key-expiration",
  LOGO: "https://devcoderz.vercel.app/pw.png"
};

const $ = (id) => document.getElementById(id);

const state = {
  loading: true,
  loadingText: "Initializing...",
  loadingProgress: 0,
  videoUrl: null,
  youtubeId: null,
  playing: false,
  duration: 0,
  currentTime: 0,
  loadedTime: 0,
  seeking: false,
  buffering: false,
  controlsVisible: true,
  playbackSpeed: 1,
  qualities: [],
  selectedQuality: null,
  manualQuality: false,
  preferredHeight: null,
  lectures: [],
  attachments: [],
  currentScheduleId: null,
  volume: 1,
  muted: false
};

const refs = {
  video: $("video"),
  root: $("rootPlayer"),
  player: $("player"),
  youtubeLayer: $("youtubeLayer"),
  ytContainer: $("ytContainer"),
  loader: $("loader"),
  loaderText: $("loaderText"),
  loaderBar: $("loaderBar"),
  loaderPercent: $("loaderPercent"),
  buffering: $("buffering"),
  settingsPanel: $("settingsPanel"),
  settingsMain: $("settingsMain"),
  speedSub: $("speedSub"),
  qualitySub: $("qualitySub"),
  qualityRow: $("qualityRow"),
  speedValue: $("speedValue"),
  qualityValue: $("qualityValue"),
  progressBar: $("progressBar"),
  progressLoaded: $("progressLoaded"),
  progressPlayed: $("progressPlayed"),
  progressThumb: $("progressThumb"),
  currentTime: $("currentTime"),
  durationTime: $("durationTime"),
  playIcon: $("playIcon"),
  centerPlay: $("centerPlay"),
  errorState: $("errorState"),
  errorTitle: $("errorTitle"),
  errorText: $("errorText"),
  volumeFill: $("volumeFill"),
  volumeThumb: $("volumeThumb"),
  lecturePanel: $("lecturePanel"),
  attachmentPanel: $("attachmentPanel"),
  lectureList: $("lectureList"),
  attachmentList: $("attachmentList")
};

let shakaPlayer = null;
let ytPlayer = null;
let controlsTimer = null;
let ytProgressTimer = null;

const params = new URLSearchParams(location.search);

const qp = {
  videoId: params.get("video_id") || params.get("video") || params.get("id"),
  subjectSlug: params.get("subject_slug"),
  batchId: params.get("batch_id"),
  scheduleId: params.get("schedule_id"),
  subjectId: params.get("subject_id"),
  topicSlug: params.get("topicSlug")
};

state.currentScheduleId = qp.scheduleId;

function isKeyValid() {
  if (!CONFIG.REQUIRE_DELTA_KEY) return true;
  const key = localStorage.getItem(CONFIG.DELTA_ACCESS_KEY);
  const exp = localStorage.getItem(CONFIG.DELTA_KEY_EXPIRATION);
  if (!key || !exp) return false;
  const expMs = parseInt(exp, 10);
  if (Date.now() < expMs) return true;
  localStorage.removeItem(CONFIG.DELTA_ACCESS_KEY);
  localStorage.removeItem(CONFIG.DELTA_KEY_EXPIRATION);
  return false;
}

function setLoading(show, text = state.loadingText, progress = state.loadingProgress) {
  state.loading = show;
  state.loadingText = text;
  state.loadingProgress = Math.max(0, Math.min(100, Number(progress || 0)));
  if (!refs.loader) return;
  refs.loader.classList.toggle("show", show);
  if (refs.loaderText) refs.loaderText.textContent = text;
  if (refs.loaderBar) refs.loaderBar.style.width = state.loadingProgress + "%";
  if (refs.loaderPercent) refs.loaderPercent.textContent = Math.round(state.loadingProgress) + "%";
}

function setBuffering(show) {
  state.buffering = !!show;
  if (refs.buffering) {
    refs.buffering.style.display = show ? "block" : "none";
  }
}

function showError(title, message) {
  setLoading(false);
  if (refs.errorTitle) refs.errorTitle.textContent = title || "Video Not Available";
  if (refs.errorText) refs.errorText.textContent = message || "This video is not available right now.";
  if (refs.errorState) refs.errorState.classList.add("show");
}

function formatTime(value) {
  value = Number(value || 0);
  if (!isFinite(value)) return "00:00";
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&",
    "<": "<",
    ">": ">",
    '"': '"',
    "'": "'"
  }[m]));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Request failed " + res.status);
  }
  return res.json();
}

function extractYouTubeId(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtube.com/0")) {
      return url.pathname.slice(1).split("?")[0];
    }
    if (url.hostname.includes("youtube.com/1")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const m = url.pathname.match(/(?:embed|shorts|v)\/([^/?&]+)/);
      if (m) return m[1];
    }
  } catch (e) {}
  return /^[a-zA-Z0-9_-]{11}$/.test(input) ? input : null;
}

async function decryptPayload(payload) {
  if (!payload) return payload;
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch (e) {}
  if (!payload.includes(":")) return payload;
  const secret = localStorage.getItem("maggikhalo") || "";
  if (!secret) return payload;
  function hexToBytes(hex) {
    const clean = hex.trim();
    if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error("Invalid hex");
    return new Uint8Array(clean.match(/.{1,2}/g).map((x) => parseInt(x, 16)));
  }
  function secretToKeyBytes(secretText) {
    const enc = new TextEncoder().encode(secretText);
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = i < enc.length ? enc[i] : 0;
    return key;
  }
  try {
    const [ivHex, dataHex] = payload.split(":");
    const key = await crypto.subtle.importKey("raw", secretToKeyBytes(secret), { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, key, hexToBytes(dataHex));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (err) {
    return payload;
  }
}

async function extractKID(mpdUrl) {
  const url = `${CONFIG.BASE_API}?mpdUrl=${encodeURIComponent(mpdUrl)}`;
  const data = await fetchJSON(url);
  if (!data.success || !data.kid) throw new Error(data.error || "Failed to extract KID");
  return data.kid;
}

async function getClearKey(kid) {
  const url = `${CONFIG.BASE_API}?kid=${encodeURIComponent(kid)}`;
  const data = await fetchJSON(url);
  if (!data.success || !data.key) throw new Error(data.error || "Invalid key data");
  return data.key;
}

function addManifestQueryFilter(manifestUrl) {
  if (!shakaPlayer || !manifestUrl) return;
  const queryIndex = manifestUrl.indexOf("?");
  if (queryIndex === -1) return;
  const signedQuery = manifestUrl.slice(queryIndex + 1);
  const manifestBase = manifestUrl.slice(0, queryIndex);
  let manifestOrigin = "";
  try { manifestOrigin = new URL(manifestBase).origin; } catch (error) {}
  const net = shakaPlayer.getNetworkingEngine && shakaPlayer.getNetworkingEngine();
  if (!net) return;
  net.registerRequestFilter((type, request) => {
    const isManifestOrSegment = type === shaka.net.NetworkingEngine.RequestType.MANIFEST || type === shaka.net.NetworkingEngine.RequestType.SEGMENT;
    if (!isManifestOrSegment) return;
    if (!request.uris || !request.uris[0]) return;
    try {
      const u = new URL(request.uris[0], manifestBase);
      if (manifestOrigin && u.origin !== manifestOrigin) return;
      const alreadySigned = u.searchParams.has("Signature") || u.searchParams.has("Policy") || u.searchParams.has("Key-Pair-Id") || u.searchParams.has("Expires");
      if (!alreadySigned) {
        request.uris[0] = u.href + (u.search ? "&" : "?") + signedQuery;
      }
    } catch (error) {
      const reqUrl = request.uris[0];
      if (!reqUrl.includes("Signature=")) {
        request.uris[0] = reqUrl + (reqUrl.includes("?") ? "&" : "?") + signedQuery;
      }
    }
  });
}

function updateControlsVisibility(show = true) {
  state.controlsVisible = show;
  if (refs.player) refs.player.classList.toggle("controls-visible", show);
  if (refs.root) refs.root.classList.toggle("controls-visible", show);
  if (controlsTimer) clearTimeout(controlsTimer);
  if (show && !state.seeking && refs.settingsPanel && !refs.settingsPanel.classList.contains("show")) {
    controlsTimer = setTimeout(() => updateControlsVisibility(false), 3000);
  }
}

function updatePlayUI() {
  const playSvg = `<path d="M8 5v14l11-7z"/>`;
  const pauseSvg = `<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>`;
  const svg = state.playing ? pauseSvg : playSvg;
  if (refs.playIcon) refs.playIcon.innerHTML = svg;
  if (refs.centerPlay) {
    refs.centerPlay.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${svg}</svg>`;
    refs.centerPlay.classList.toggle("pause", state.playing);
  }
  if (refs.player) refs.player.classList.toggle("playing", state.playing);
  if (refs.root) refs.root.classList.toggle("playing", state.playing);
}

function updateProgressUI() {
  const duration = state.duration || 0;
  const current = state.currentTime || 0;
  const playedPercent = duration ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
  const loadedPercent = duration ? Math.max(0, Math.min(100, (state.loadedTime / duration) * 100)) : 0;
  if (refs.currentTime) refs.currentTime.textContent = formatTime(current);
  if (refs.durationTime) refs.durationTime.textContent = formatTime(duration);
  if (refs.progressPlayed) refs.progressPlayed.style.width = playedPercent + "%";
  if (refs.progressLoaded) refs.progressLoaded.style.width = loadedPercent + "%";
  if (refs.progressThumb) refs.progressThumb.style.left = playedPercent + "%";
}

function updateVolumeUI() {
  const percent = state.muted ? 0 : state.volume * 100;
  if (refs.volumeFill) refs.volumeFill.style.width = percent + "%";
  if (refs.volumeThumb) refs.volumeThumb.style.left = percent + "%";
}

function togglePlay() {
  if (state.youtubeId && ytPlayer) {
    if (ytPlayer.getPlayerState() === 1) { ytPlayer.pauseVideo(); state.playing = false; }
    else { ytPlayer.playVideo(); state.playing = true; }
    updatePlayUI();
    return;
  }
  const v = refs.video;
  if (!v) return;
  if (v.paused) { v.play().then(() => { state.playing = true; updatePlayUI(); }).catch(() => {}); }
  else { v.pause(); state.playing = false; updatePlayUI(); }
}

function seekBy(seconds) {
  if (state.youtubeId && ytPlayer) {
    ytPlayer.seekTo(Math.max(0, Math.min((ytPlayer.getCurrentTime() || 0) + seconds, state.duration)), true);
  } else if (refs.video) {
    refs.video.currentTime = Math.max(0, Math.min(refs.video.currentTime + seconds, state.duration));
  }
}

function seekToPosition(clientX) {
  if (!refs.progressBar) return;
  const rect = refs.progressBar.getBoundingClientRect();
  const time = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (state.duration || 0);
  if (state.youtubeId && ytPlayer) ytPlayer.seekTo(time, true);
  else if (refs.video) refs.video.currentTime = time;
}

function setVolume(value) {
  state.volume = Math.max(0, Math.min(1, Number(value)));
  state.muted = state.volume <= 0;
  if (state.youtubeId && ytPlayer) {
    ytPlayer.setVolume(Math.round(state.volume * 100));
    state.muted ? ytPlayer.mute() : ytPlayer.unMute();
  } else if (refs.video) {
    refs.video.volume = state.volume;
    refs.video.muted = state.muted;
  }
  updateVolumeUI();
}

function setPlaybackSpeed(speed) {
  state.playbackSpeed = speed;
  if (refs.speedValue) refs.speedValue.textContent = speed === 1 ? "1" : String(speed);
  if (state.youtubeId && ytPlayer) ytPlayer.setPlaybackRate(speed);
  else if (refs.video) refs.video.playbackRate = speed;
  closeSettings();
}

function refreshQualities() {
  if (!shakaPlayer) return;
  const tracks = shakaPlayer.getVariantTracks();
  state.qualities = tracks.filter((t) => t.height).sort((a, b) => b.height - a.height).filter((t, i, arr) => i === 0 || t.height !== arr[i - 1].height);
  if (refs.qualityRow) refs.qualityRow.style.display = state.qualities.length ? "flex" : "none";
  updateQualityText();
}

function updateQualityText() {
  if (refs.qualityValue) refs.qualityValue.textContent = state.selectedQuality ? `${state.selectedQuality.height}p` : "Auto";
}

function selectQuality(id) {
  if (!shakaPlayer) return;
  const track = shakaPlayer.getVariantTracks().find((t) => t.id === id);
  if (!track) return;
  shakaPlayer.configure({ abr: { enabled: false } });
  shakaPlayer.selectVariantTrack(track, true);
  state.selectedQuality = track;
  state.manualQuality = true;
  updateQualityText();
  closeSettings();
}

function autoQuality() {
  if (!shakaPlayer) return;
  shakaPlayer.configure({ abr: { enabled: true } });
  state.selectedQuality = null;
  state.manualQuality = false;
  updateQualityText();
  closeSettings();
}

function openSettingsPanel(type) {
  refs.settingsMain.style.display = "none";
  refs.speedSub.style.display = type === "speed" ? "block" : "none";
  refs.qualitySub.style.display = type === "quality" ? "block" : "none";
}

function closeSettings() {
  refs.settingsPanel.classList.remove("show");
  refs.settingsMain.style.display = "block";
  refs.speedSub.style.display = "none";
  refs.qualitySub.style.display = "none";
}

async function setupYouTube(videoId) {
  state.youtubeId = videoId;
  refs.video.style.display = "none";
  refs.youtubeLayer.style.display = "block";
  refs.ytContainer.innerHTML = `<div id="yt-player-div"></div>`;
  ytPlayer = new YT.Player("yt-player-div", {
    videoId, width: "100%", height: "100%",
    playerVars: { autoplay: 0, controls: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
    events: {
      onReady: (e) => { setLoading(false); },
      onStateChange: (e) => { if(e.data===1) state.playing=true; else state.playing=false; updatePlayUI(); }
    }
  });
}

async function setupShaka(url) {
  state.youtubeId = null;
  refs.video.style.display = "block";
  refs.youtubeLayer.style.display = "none";
  if (shakaPlayer) await shakaPlayer.destroy();
  const player = new shaka.Player();
  shakaPlayer = player;
  await player.attach(refs.video);
  player.addEventListener("buffering", (e) => setBuffering(e.buffering));
  player.addEventListener("trackschanged", refreshQualities);
  if (url.includes(".mpd")) {
    const kid = await extractKID(url);
    const key = await getClearKey(kid);
    player.configure({ drm: { clearKeys: { [kid]: key } } });
  }
  addManifestQueryFilter(url);
  await player.load(url);
  refreshQualities();
}

async function resolveVideoUrl() {
  const url = `${CONFIG.BASE_API}?batchId=${qp.batchId}&childId=${qp.videoId}&subjectId=${qp.subjectId}`;
  const data = await fetchJSON(url);
  return { url: data.data[0].url, isYouTube: data.data[0].type === "youtube" };
}

async function loadMainVideo() {
  if (!isKeyValid()) { location.href = "/delta-auth"; return; }
  try {
    const result = await resolveVideoUrl();
    if (result.isYouTube) await setupYouTube(extractYouTubeId(result.url) || result.url);
    else await setupShaka(result.url);
    setLoading(false);
  } catch (err) { showError("Failed", "Video load error"); }
}

function bindEvents() {
  $("backBtn")?.addEventListener("click", () => history.back());
  $("playBtn")?.addEventListener("click", togglePlay);
  $("settingsBtn")?.addEventListener("click", () => refs.settingsPanel.classList.add("show"));
}

async function init() {
  bindEvents();
  await loadMainVideo();
}

init();