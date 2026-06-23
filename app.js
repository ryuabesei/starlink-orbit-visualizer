import * as THREE from "https://esm.sh/three@0.165.0";
import { OrbitControls } from "https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js";
import * as satellite from "https://esm.sh/satellite.js@5.0.0";

const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle";
const LOCAL_TLE_URL = "/api/starlink-tle";
const TLE_CACHE_KEY = "starlink-orbit-visualizer:tles";
const EARTH_TEXTURE_URL = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";
const EARTH_KM = 6371;
const EARTH_RADIUS = 1;
const SATELLITE_SCALE = 1.2;
const ORBIT_STEPS = 96;
const ORBIT_MINUTES = 100;
const MAP_TRACK_MINUTES = 120;
const MAP_TRACK_STEPS = 96;
const ALTITUDE_BANDS = [
  { max: 400, label: "< 400 km", color: 0xb78cff },
  { max: 500, label: "400-500 km", color: 0x67d7ff },
  { max: 560, label: "500-560 km", color: 0x84f2b6 },
  { max: Infinity, label: "560 km+", color: 0xf8c45e },
];

const state = {
  satrecs: [],
  displaySats: [],
  visibleSats: [],
  orbitLines: [],
  labels: [],
  selectedSat: null,
  pinnedSat: null,
  simulationDate: new Date(),
  lastFrameTime: performance.now(),
  speed: 12,
  viewMode: "3d",
  satelliteLimit: 500,
  showAllSatellites: false,
  visibilityFilter: null,
  orbitLimit: 25,
  showOrbits: true,
  showLabels: false,
};

const els = {
  canvas: document.querySelector("#space"),
  map2d: document.querySelector("#map2d"),
  map2dCanvas: document.querySelector("#map2dCanvas"),
  satelliteCount: document.querySelector("#satelliteCount"),
  orbitCount: document.querySelector("#orbitCount"),
  simTime: document.querySelector("#simTime"),
  refreshButton: document.querySelector("#refreshButton"),
  satelliteSearchForm: document.querySelector("#satelliteSearchForm"),
  satelliteSearch: document.querySelector("#satelliteSearch"),
  satelliteSearchStatus: document.querySelector("#satelliteSearchStatus"),
  satelliteLimit: document.querySelector("#satelliteLimit"),
  satelliteLimitValue: document.querySelector("#satelliteLimitValue"),
  orbitLimit: document.querySelector("#orbitLimit"),
  orbitLimitValue: document.querySelector("#orbitLimitValue"),
  speed: document.querySelector("#speed"),
  speedValue: document.querySelector("#speedValue"),
  showAllSatellites: document.querySelector("#showAllSatellites"),
  showOrbits: document.querySelector("#showOrbits"),
  showLabels: document.querySelector("#showLabels"),
  view3dButton: document.querySelector("#view3dButton"),
  view2dButton: document.querySelector("#view2dButton"),
  readout: document.querySelector("#readout"),
  thermospherePlot: document.querySelector("#thermospherePlot"),
  reentryWatchList: document.querySelector("#reentryWatchList"),
  updateWatchButton: document.querySelector("#updateWatchButton"),
  observerPreset: document.querySelector("#observerPreset"),
  observerLat: document.querySelector("#observerLat"),
  observerLon: document.querySelector("#observerLon"),
  minElevation: document.querySelector("#minElevation"),
  computeVisibilityButton: document.querySelector("#computeVisibilityButton"),
  clearVisibilityButton: document.querySelector("#clearVisibilityButton"),
  visibilityResults: document.querySelector("#visibilityResults"),
  exportPngButton: document.querySelector("#exportPngButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
};

const renderer = new THREE.WebGLRenderer({
  canvas: els.canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(els.canvas.clientWidth, els.canvas.clientHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 120);
camera.position.set(0, 2.2, 4.1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.04;
controls.minDistance = 1.45;
controls.maxDistance = 10;

const ambient = new THREE.AmbientLight(0x6f8797, 1.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-4, 2.4, 3);
scene.add(sun);

const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 96, 64),
  new THREE.MeshStandardMaterial({
    color: 0x153a4f,
    roughness: 0.78,
    metalness: 0.05,
    emissive: 0x05111a,
    emissiveIntensity: 0.18,
  }),
);
earthGroup.add(earth);
loadEarthTexture();

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.025, 96, 64),
  new THREE.MeshBasicMaterial({
    color: 0x2fb8ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide,
  }),
);
earthGroup.add(atmosphere);

addLatLongLines();
addStars();

const satelliteGeometry = new THREE.SphereGeometry(0.0055, 10, 8);
let satelliteMeshCapacity = 1500;
let satelliteMeshes = createSatelliteMeshes(satelliteMeshCapacity);

const searchedSatelliteMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.018, 18, 14),
  new THREE.MeshBasicMaterial({
    color: 0xff3b30,
    transparent: true,
    opacity: 0.96,
  }),
);
searchedSatelliteMarker.visible = false;
scene.add(searchedSatelliteMarker);

const searchedSatelliteHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.031, 18, 14),
  new THREE.MeshBasicMaterial({
    color: 0xff3b30,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
  }),
);
searchedSatelliteHalo.visible = false;
scene.add(searchedSatelliteHalo);

const orbitGroup = new THREE.Group();
scene.add(orbitGroup);

const dummy = new THREE.Object3D();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mapCtx = els.map2dCanvas.getContext("2d");

els.refreshButton.addEventListener("click", loadTle);
els.updateWatchButton.addEventListener("click", updateReentryWatchList);
els.computeVisibilityButton.addEventListener("click", computeVisibility);
els.clearVisibilityButton.addEventListener("click", clearVisibilityFilter);
els.observerPreset.addEventListener("change", applyObserverPreset);
els.reentryWatchList.addEventListener("click", handleMiniListClick);
els.visibilityResults.addEventListener("click", handleMiniListClick);
els.exportPngButton.addEventListener("click", exportPngReport);
els.exportCsvButton.addEventListener("click", exportCsvReport);
els.satelliteSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchSatellite();
});
els.satelliteLimit.addEventListener("input", () => {
  state.satelliteLimit = Number(els.satelliteLimit.value);
  els.satelliteLimitValue.textContent = String(state.satelliteLimit);
  rebuildSatellites();
});
els.showAllSatellites.addEventListener("change", () => {
  state.showAllSatellites = els.showAllSatellites.checked;
  updateSatelliteLimitControl();
  ensureSatelliteMeshCapacity(state.satrecs.length || satelliteMeshCapacity);
  rebuildSatellites();
});
els.orbitLimit.addEventListener("input", () => {
  state.orbitLimit = Number(els.orbitLimit.value);
  els.orbitLimitValue.textContent = String(state.orbitLimit);
  rebuildOrbits();
});
els.speed.addEventListener("input", () => {
  state.speed = Number(els.speed.value);
  els.speedValue.textContent = `${state.speed}x`;
});
els.showOrbits.addEventListener("change", () => {
  state.showOrbits = els.showOrbits.checked;
  orbitGroup.visible = state.showOrbits;
});
els.showLabels.addEventListener("change", () => {
  state.showLabels = els.showLabels.checked;
  updateLabelVisibility();
});
els.view3dButton.addEventListener("click", () => setViewMode("3d"));
els.view2dButton.addEventListener("click", () => setViewMode("2d"));
els.canvas.addEventListener("pointermove", onPointerMove);
els.canvas.addEventListener("click", onCanvasClick);
els.map2dCanvas.addEventListener("pointermove", onMapPointerMove);
els.map2dCanvas.addEventListener("click", onMapClick);
window.addEventListener("resize", resize);

setViewMode(state.viewMode);
loadTle();
animate();

function loadEarthTexture() {
  const loader = new THREE.TextureLoader();
  loader.load(
    EARTH_TEXTURE_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earth.material.dispose();
      earth.material = new THREE.MeshBasicMaterial({ map: texture });
    },
    undefined,
    () => {
      setReadout("地球テクスチャ未読込", "地球画像を取得できなかったため、単色表示で続行しています");
    },
  );
}

async function loadTle() {
  setReadout("TLE取得中", "CelesTrakからStarlinkグループを読み込んでいます");
  els.refreshButton.disabled = true;

  try {
    const text = await fetchTleText();
    const parsed = parseTle(text);
    if (parsed.length === 0) {
      throw new Error("TLEの解析結果が0件でした");
    }

    const fetchedAt = Date.now();
    state.satrecs = parsed;
    state.simulationDate = new Date();
    localStorage.setItem(TLE_CACHE_KEY, JSON.stringify({ fetchedAt, text }));
    ensureSatelliteMeshCapacity(parsed.length);
    rebuildSatellites();
    rebuildOrbits();
    setReadout("取得完了", tleReadoutLines(parsed, fetchedAt));
  } catch (error) {
    const cached = loadCachedTle();
    if (cached) {
      state.satrecs = cached.parsed;
      state.simulationDate = new Date();
      ensureSatelliteMeshCapacity(cached.parsed.length);
      rebuildSatellites();
      rebuildOrbits();
      setReadout(
        "キャッシュ表示",
        [
          `公開TLEの再取得に失敗したため、${cached.ageText}前の取得データを表示しています`,
          ...tleReadoutLines(cached.parsed, cached.fetchedAt),
        ],
      );
    } else {
      const demo = parseTle(generateDemoTle());
      state.satrecs = demo;
      state.simulationDate = new Date();
      ensureSatelliteMeshCapacity(demo.length);
      rebuildSatellites();
      rebuildOrbits();
      setReadout("デモ表示", `公開TLEを取得できませんでした。接続回復後にTLE更新を押してください: ${error.message}`);
    }
  } finally {
    els.refreshButton.disabled = false;
  }
}

function createSatelliteMeshes(capacity) {
  return ALTITUDE_BANDS.map((band, index) => {
    const mesh = new THREE.InstancedMesh(
      satelliteGeometry,
      new THREE.MeshBasicMaterial({ color: band.color }),
      capacity,
    );
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.bandIndex = index;
    mesh.userData.sats = [];
    scene.add(mesh);
    return mesh;
  });
}

function ensureSatelliteMeshCapacity(capacity) {
  if (capacity <= satelliteMeshCapacity) return;

  for (const mesh of satelliteMeshes) {
    scene.remove(mesh);
    mesh.material.dispose();
  }

  satelliteMeshCapacity = Math.ceil(capacity / 500) * 500;
  satelliteMeshes = createSatelliteMeshes(satelliteMeshCapacity);
}

async function fetchTleText() {
  const urls = location.protocol.startsWith("http")
    ? [LOCAL_TLE_URL, TLE_URL]
    : [TLE_URL];

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`${url} HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("TLE fetch failed");
}

function loadCachedTle() {
  try {
    const cached = JSON.parse(localStorage.getItem(TLE_CACHE_KEY) || "null");
    if (!cached?.text || !cached?.fetchedAt) return null;

    const parsed = parseTle(cached.text);
    if (parsed.length === 0) return null;

    const ageMinutes = Math.max(1, Math.round((Date.now() - cached.fetchedAt) / 60000));
    const ageText = ageMinutes < 60
      ? `${ageMinutes}分`
      : `${Math.round(ageMinutes / 60)}時間`;

    return { parsed, ageText, fetchedAt: cached.fetchedAt };
  } catch {
    return null;
  }
}

function tleReadoutLines(sats, fetchedAt) {
  return [
    `${sats.length.toLocaleString()}機のStarlink TLEを読み込みました`,
    `取得時刻: ${formatDateTime(new Date(fetchedAt))}`,
    `TLE最新epoch: ${latestTleEpoch(sats)}`,
  ];
}

function latestTleEpoch(sats) {
  const latest = sats.reduce((max, sat) => {
    const epoch = sat?.satrec?.jdsatepoch;
    return Number.isFinite(epoch) && epoch > max ? epoch : max;
  }, -Infinity);

  if (!Number.isFinite(latest)) return "不明";
  return formatDateTime(julianDateToDate(latest));
}

function julianDateToDate(julianDate) {
  return new Date((julianDate - 2440587.5) * 86400000);
}

function generateDemoTle() {
  const blocks = [];
  for (let index = 0; index < 120; index += 1) {
    const id = String(44713 + index).padStart(5, "0");
    const raan = ((index * 13.7) % 360).toFixed(4).padStart(8, " ");
    const anomaly = ((index * 31.1) % 360).toFixed(4).padStart(8, " ");
    const perigee = ((index * 7.9) % 360).toFixed(4).padStart(8, " ");
    const motion = (15.055 + (index % 9) * 0.002).toFixed(8).padStart(11, " ");

    blocks.push(
      `STARLINK-DEMO-${String(index + 1).padStart(3, "0")}`,
      `1 ${id}U 19074A   24164.50000000  .00001264  00000+0  90000-4 0  9990`,
      `2 ${id}  53.0000 ${raan} 0001200 ${perigee} ${anomaly} ${motion}    00`,
    );
  }

  return blocks.join("\n");
}

function parseTle(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      i -= 2;
      continue;
    }

    try {
      parsed.push({
        name,
        satrec: satellite.twoline2satrec(line1, line2),
        line1,
        line2,
      });
    } catch {
      // Skip malformed rows; CelesTrak normally returns clean 3-line TLE blocks.
    }
  }

  return parsed;
}

function rebuildSatellites() {
  const sourceSats = state.visibilityFilter
    ? state.satrecs.filter((sat) => state.visibilityFilter.satnums.has(String(sat.satrec.satnum)))
    : state.satrecs;

  const displaySats = state.visibilityFilter || state.showAllSatellites
    ? sourceSats.slice()
    : sampleSatellites(sourceSats, state.satelliteLimit);

  if (state.visibilityFilter) {
    ensureSatelliteMeshCapacity(displaySats.length || satelliteMeshCapacity);
  }

  state.displaySats = includePinnedSatellite(displaySats);
  els.satelliteCount.textContent = state.displaySats.length.toLocaleString();
  updateSatelliteLimitControl();
  rebuildLabels();
  updateSatellites();
  updateThermospherePlot();
  updateReentryWatchList();
}

function includePinnedSatellite(displaySats) {
  if (!state.pinnedSat || displaySats.includes(state.pinnedSat)) return displaySats;
  if (displaySats.length === 0) return [state.pinnedSat];

  const next = displaySats.slice();
  next[next.length - 1] = state.pinnedSat;
  return next;
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.body.dataset.viewMode = mode;
  els.view3dButton.setAttribute("aria-pressed", String(mode === "3d"));
  els.view2dButton.setAttribute("aria-pressed", String(mode === "2d"));
  els.canvas.style.pointerEvents = mode === "3d" ? "auto" : "none";
  els.map2dCanvas.style.pointerEvents = mode === "2d" ? "auto" : "none";
  updateLabelVisibility();
  resize();
  drawMap2d();
}

function searchSatellite() {
  const query = normalizeSatelliteQuery(els.satelliteSearch.value);
  if (!query) {
    setSearchStatus("衛星名またはNORAD番号を入力してください");
    return;
  }

  const sat = state.satrecs.find((candidate) => {
    const name = normalizeSatelliteQuery(candidate.name);
    const satnum = String(candidate.satrec.satnum ?? candidate.line1.slice(2, 7).trim());
    return name.includes(query) || satnum === query;
  });

  if (!sat) {
    setSearchStatus(`該当する衛星が見つかりません: ${els.satelliteSearch.value}`);
    return;
  }

  selectSatellite(sat);
  setSearchStatus(`${sat.name} / NORAD ${sat.satrec.satnum} を赤で強調表示中`);
}

function normalizeSatelliteQuery(value) {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^SL-/, "STARLINK-");
}

function setSearchStatus(message) {
  els.satelliteSearchStatus.textContent = message;
}

function selectSatellite(sat, options = {}) {
  const { focus = true } = options;
  state.pinnedSat = sat;
  state.selectedSat = sat;
  rebuildSatellites();
  if (focus) {
    focusSatellite(sat);
  } else {
    updateSearchedSatelliteMarker();
  }
  showSatelliteDetails(sat);
  drawMap2d();
}

function focusSatellite(sat) {
  const telemetry = satelliteTelemetry(sat.satrec, state.simulationDate);
  if (!telemetry) return;

  sat.screenPosition = telemetry.position;
  sat.telemetry = telemetry;
  const direction = telemetry.position.clone().normalize();
  const target = telemetry.position.clone();
  const cameraDistance = 1.9;
  camera.position.copy(target.clone().add(direction.multiplyScalar(cameraDistance)));
  controls.target.copy(target);
  updateSearchedSatelliteMarker();
  controls.update();
}

function drawMap2d() {
  if (state.viewMode !== "2d") return;

  resizeMapCanvas();
  const ratio = mapPixelRatio();
  const width = els.map2dCanvas.width / ratio;
  const height = els.map2dCanvas.height / ratio;
  mapCtx.save();
  mapCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  mapCtx.clearRect(0, 0, width, height);
  drawMapGrid(width, height);
  drawSelectedGroundTrack(width, height);
  drawMapSatellites(width, height);
  mapCtx.restore();
}

function resizeMapCanvas() {
  const rect = els.map2dCanvas.getBoundingClientRect();
  const ratio = mapPixelRatio();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (els.map2dCanvas.width !== width || els.map2dCanvas.height !== height) {
    els.map2dCanvas.width = width;
    els.map2dCanvas.height = height;
  }
}

function mapPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function drawMapGrid(width, height) {
  mapCtx.strokeStyle = "rgba(237, 247, 255, 0.18)";
  mapCtx.lineWidth = 1;

  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * width;
    mapCtx.beginPath();
    mapCtx.moveTo(x, 0);
    mapCtx.lineTo(x, height);
    mapCtx.stroke();
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    mapCtx.beginPath();
    mapCtx.moveTo(0, y);
    mapCtx.lineTo(width, y);
    mapCtx.stroke();
  }
}

function drawSelectedGroundTrack(width, height) {
  const sat = state.selectedSat ?? state.pinnedSat;
  if (!sat || !state.showOrbits) return;

  const points = buildGroundTrack(sat.satrec, state.simulationDate);
  if (points.length < 2) return;

  mapCtx.strokeStyle = "rgba(237, 247, 255, 0.9)";
  mapCtx.lineWidth = 2;
  mapCtx.setLineDash([5, 5]);
  mapCtx.beginPath();

  let previous = null;
  for (const point of points) {
    const projected = geoToMap(point.latitudeDeg, point.longitudeDeg, width, height);
    if (!previous || Math.abs(projected.x - previous.x) > width * 0.45) {
      mapCtx.moveTo(projected.x, projected.y);
    } else {
      mapCtx.lineTo(projected.x, projected.y);
    }
    previous = projected;
  }

  mapCtx.stroke();
  mapCtx.setLineDash([]);
}

function buildGroundTrack(satrec, centerDate) {
  const points = [];
  const start = centerDate.getTime() - (MAP_TRACK_MINUTES * 60 * 1000) / 2;
  const stepMs = (MAP_TRACK_MINUTES * 60 * 1000) / MAP_TRACK_STEPS;

  for (let index = 0; index <= MAP_TRACK_STEPS; index += 1) {
    const telemetry = satelliteTelemetry(satrec, new Date(start + index * stepMs));
    if (telemetry) points.push(telemetry);
  }

  return points;
}

function drawMapSatellites(width, height) {
  for (const sat of state.displaySats) {
    const telemetry = sat.telemetry ?? satelliteTelemetry(sat.satrec, state.simulationDate);
    if (!telemetry) continue;

    const projected = geoToMap(telemetry.latitudeDeg, telemetry.longitudeDeg, width, height);
    const isPinned = sat === state.pinnedSat || sat === state.selectedSat;
    mapCtx.beginPath();
    mapCtx.fillStyle = isPinned ? "#ff3b30" : colorToCss(altitudeBand(telemetry.altitudeKm).color);
    mapCtx.globalAlpha = isPinned ? 1 : 0.82;
    mapCtx.arc(projected.x, projected.y, isPinned ? 5.5 : 2.1, 0, Math.PI * 2);
    mapCtx.fill();

    if (isPinned) {
      mapCtx.globalAlpha = 0.32;
      mapCtx.beginPath();
      mapCtx.arc(projected.x, projected.y, 12, 0, Math.PI * 2);
      mapCtx.fill();
    }
    mapCtx.globalAlpha = 1;
  }
}

function geoToMap(latitudeDeg, longitudeDeg, width, height) {
  const lon = wrapLongitude(longitudeDeg);
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - THREE.MathUtils.clamp(latitudeDeg, -90, 90)) / 180) * height,
  };
}

function wrapLongitude(longitudeDeg) {
  return ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
}

function colorToCss(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function onMapPointerMove(event) {
  const sat = pickMapSatellite(event);
  els.map2dCanvas.style.cursor = sat ? "pointer" : "crosshair";
  if (!sat || state.selectedSat) return;
  setReadout("2D地図ホバー", sat.name);
}

function onMapClick(event) {
  const sat = pickMapSatellite(event);
  if (sat) selectSatellite(sat);
}

function pickMapSatellite(event) {
  const rect = els.map2dCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let nearest = null;
  let nearestDistance = 10;

  for (const sat of state.displaySats) {
    const telemetry = sat.telemetry ?? satelliteTelemetry(sat.satrec, state.simulationDate);
    if (!telemetry) continue;

    const projected = geoToMap(telemetry.latitudeDeg, telemetry.longitudeDeg, rect.width, rect.height);
    const distance = Math.hypot(x - projected.x, y - projected.y);
    if (distance < nearestDistance) {
      nearest = sat;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function handleMiniListClick(event) {
  const item = event.target.closest("[data-norad]");
  if (!item) return;

  const sat = findSatelliteByNorad(item.dataset.norad);
  if (sat) selectSatellite(sat);
}

function findSatelliteByNorad(norad) {
  return state.satrecs.find((sat) => String(sat.satrec.satnum) === String(norad));
}

function updateReentryWatchList() {
  if (!els.reentryWatchList) return;
  if (state.satrecs.length === 0) {
    els.reentryWatchList.innerHTML = "<strong>衛星データ取得後に表示</strong>";
    return;
  }

  const items = state.satrecs
    .map((sat) => {
      const telemetry = satelliteTelemetry(sat.satrec, state.simulationDate);
      const proxy = thermosphereProxy(sat);
      if (!telemetry) return null;

      const lowAltitude = telemetry.altitudeKm < 300;
      const highDrag = (proxy?.index ?? 0) >= 70;
      if (!lowAltitude && !highDrag) return null;

      const score = Math.max(0, 300 - telemetry.altitudeKm) * 1.4 + (proxy?.index ?? 0);
      return { sat, telemetry, proxy, lowAltitude, highDrag, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (items.length === 0) {
    els.reentryWatchList.innerHTML = "<strong>該当衛星なし</strong>";
    return;
  }

  els.reentryWatchList.innerHTML = items.map((item) => `
    <button class="mini-item" type="button" data-norad="${escapeHtml(item.sat.satrec.satnum)}">
      <b>${escapeHtml(item.sat.name)} / ${escapeHtml(item.sat.satrec.satnum)}</b>
      <span>${item.lowAltitude ? "低高度" : "高BSTAR"} ・ 高度 ${item.telemetry.altitudeKm.toFixed(1)} km ・ proxy ${item.proxy?.index.toFixed(1) ?? "-"}</span>
    </button>
  `).join("");
}

function applyObserverPreset() {
  const value = els.observerPreset.value;
  if (value === "custom") return;

  const [lat, lon] = value.split(",");
  els.observerLat.value = lat;
  els.observerLon.value = lon;
}

function observerFromInputs() {
  const latitudeDeg = Number(els.observerLat.value);
  const longitudeDeg = Number(els.observerLon.value);
  const minElevationDeg = Number(els.minElevation.value);

  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
    throw new Error("緯度・経度を数値で入力してください");
  }

  return {
    latitudeDeg,
    longitudeDeg,
    minElevationDeg: Number.isFinite(minElevationDeg) ? minElevationDeg : 25,
    geodetic: {
      latitude: THREE.MathUtils.degToRad(latitudeDeg),
      longitude: THREE.MathUtils.degToRad(longitudeDeg),
      height: 0,
    },
  };
}

function computeVisibility() {
  if (state.satrecs.length === 0) {
    els.visibilityResults.innerHTML = "<strong>衛星データを先に取得してください</strong>";
    return;
  }

  let observer;
  try {
    observer = observerFromInputs();
  } catch (error) {
    els.visibilityResults.innerHTML = `<strong>${escapeHtml(error.message)}</strong>`;
    return;
  }

  els.computeVisibilityButton.disabled = true;
  try {
    const visibleNow = state.satrecs
      .map((sat) => {
        const look = lookAnglesForSatellite(sat, observer, state.simulationDate);
        if (!look || look.elevationDeg < observer.minElevationDeg) return null;
        return { sat, look };
      })
      .filter(Boolean)
      .sort((a, b) => b.look.elevationDeg - a.look.elevationDeg);

    const upcoming = findUpcomingPasses(observer, 8);
    state.visibilityFilter = {
      satnums: new Set(visibleNow.map(({ sat }) => String(sat.satrec.satnum))),
      observer,
    };
    rebuildSatellites();
    els.visibilityResults.innerHTML = renderVisibilityResults(visibleNow, upcoming, observer);
  } finally {
    els.computeVisibilityButton.disabled = false;
  }
}

function clearVisibilityFilter() {
  state.visibilityFilter = null;
  rebuildSatellites();
  els.visibilityResults.innerHTML = "<strong>可視衛星フィルタを解除しました</strong>";
}

function lookAnglesForSatellite(sat, observer, date) {
  const telemetry = satelliteTelemetry(sat.satrec, date);
  if (!telemetry?.ecf) return null;

  const look = satellite.ecfToLookAngles(observer.geodetic, telemetry.ecf);
  return {
    azimuthDeg: THREE.MathUtils.radToDeg(look.azimuth),
    elevationDeg: THREE.MathUtils.radToDeg(look.elevation),
    rangeKm: look.rangeSat,
    telemetry,
  };
}

function findUpcomingPasses(observer, limit) {
  const candidates = sampleSatellites(state.satrecs, Math.min(state.satrecs.length, 750));
  const passes = [];

  for (const sat of candidates) {
    for (let minute = 0; minute <= 180; minute += 3) {
      const date = new Date(state.simulationDate.getTime() + minute * 60 * 1000);
      const look = lookAnglesForSatellite(sat, observer, date);
      if (look && look.elevationDeg >= observer.minElevationDeg) {
        passes.push({ sat, look, date, minute });
        break;
      }
    }
  }

  return passes
    .sort((a, b) => a.minute - b.minute || b.look.elevationDeg - a.look.elevationDeg)
    .slice(0, limit);
}

function renderVisibilityResults(visibleNow, upcoming, observer) {
  const visibleHtml = visibleNow.length > 0
    ? visibleNow.slice(0, 10).map(({ sat, look }) => miniVisibilityItem(sat, `仰角 ${look.elevationDeg.toFixed(1)}° ・ 方位 ${look.azimuthDeg.toFixed(1)}° ・ 距離 ${look.rangeKm.toFixed(0)} km`)).join("")
    : "<strong>現在しきい値以上で見える衛星はありません</strong>";

  const upcomingHtml = upcoming.length > 0
    ? upcoming.map(({ sat, look, date, minute }) => miniVisibilityItem(sat, `${minute}分後 ・ ${formatDateTime(date)} ・ 最大候補仰角 ${look.elevationDeg.toFixed(1)}°`)).join("")
    : "<strong>次回通過候補なし</strong>";

  return `
    <strong>現在見える衛星 ${visibleNow.length.toLocaleString()}機 (${observer.minElevationDeg.toFixed(0)}°以上・地図に反映中)</strong>
    ${visibleHtml}
    <strong>次回通過候補（サンプル探索）</strong>
    ${upcomingHtml}
  `;
}

function miniVisibilityItem(sat, detail) {
  return `
    <button class="mini-item" type="button" data-norad="${escapeHtml(sat.satrec.satnum)}">
      <b>${escapeHtml(sat.name)} / ${escapeHtml(sat.satrec.satnum)}</b>
      <span>${escapeHtml(detail)}</span>
    </button>
  `;
}

function updateSatelliteLimitControl() {
  els.satelliteLimit.disabled = state.showAllSatellites || Boolean(state.visibilityFilter);
  els.satelliteLimitValue.textContent = state.visibilityFilter
    ? `可視 ${state.displaySats.length.toLocaleString()}`
    : state.showAllSatellites
      ? `全 ${state.satrecs.length.toLocaleString()}`
    : String(state.satelliteLimit);
}

function rebuildOrbits() {
  orbitGroup.clear();
  state.orbitLines = [];

  const orbitSats = sampleSatellites(state.satrecs, state.orbitLimit);
  for (const sat of orbitSats) {
    const points = buildOrbitPoints(sat.satrec, state.simulationDate);
    if (points.length < 2) continue;

    const telemetry = satelliteTelemetry(sat.satrec, state.simulationDate);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: altitudeBand(telemetry?.altitudeKm).color,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geometry, material);
    orbitGroup.add(line);
    state.orbitLines.push(line);
  }

  orbitGroup.visible = state.showOrbits;
  els.orbitCount.textContent = state.orbitLines.length.toLocaleString();
}

function sampleSatellites(sats, limit) {
  if (sats.length <= limit) return sats.slice();

  const sampled = [];
  const step = (sats.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    sampled.push(sats[Math.round(index * step)]);
  }

  return sampled;
}

function buildOrbitPoints(satrec, startDate) {
  const points = [];
  const start = startDate.getTime() - (ORBIT_MINUTES * 60 * 1000) / 2;
  const stepMs = (ORBIT_MINUTES * 60 * 1000) / ORBIT_STEPS;

  for (let i = 0; i <= ORBIT_STEPS; i += 1) {
    const date = new Date(start + i * stepMs);
    const point = satPosition(satrec, date);
    if (point) points.push(point);
  }

  return points;
}

function updateSatellites() {
  let visible = 0;
  const counts = new Array(satelliteMeshes.length).fill(0);
  state.visibleSats = [];
  for (const mesh of satelliteMeshes) {
    mesh.userData.sats = [];
  }

  for (const sat of state.displaySats) {
    const telemetry = satelliteTelemetry(sat.satrec, state.simulationDate);
    if (!telemetry) continue;

    const band = altitudeBand(telemetry.altitudeKm);
    const bandIndex = ALTITUDE_BANDS.indexOf(band);
    const mesh = satelliteMeshes[bandIndex];
    const meshIndex = counts[bandIndex];

    dummy.position.copy(telemetry.position);
    dummy.scale.setScalar(SATELLITE_SCALE);
    dummy.updateMatrix();
    mesh.setMatrixAt(meshIndex, dummy.matrix);
    sat.screenPosition = telemetry.position;
    sat.telemetry = telemetry;
    sat.altitudeBand = band;
    mesh.userData.sats[meshIndex] = sat;
    state.visibleSats[visible] = sat;
    counts[bandIndex] += 1;
    visible += 1;
  }

  satelliteMeshes.forEach((mesh, index) => {
    mesh.count = counts[index];
    mesh.instanceMatrix.needsUpdate = true;
  });

  updateSearchedSatelliteMarker();
}

function updateSearchedSatelliteMarker() {
  if (!state.pinnedSat) {
    searchedSatelliteMarker.visible = false;
    searchedSatelliteHalo.visible = false;
    return;
  }

  const telemetry = state.pinnedSat.telemetry ?? satelliteTelemetry(state.pinnedSat.satrec, state.simulationDate);
  if (!telemetry) {
    searchedSatelliteMarker.visible = false;
    searchedSatelliteHalo.visible = false;
    return;
  }

  state.pinnedSat.telemetry = telemetry;
  state.pinnedSat.screenPosition = telemetry.position;
  searchedSatelliteMarker.position.copy(telemetry.position);
  searchedSatelliteHalo.position.copy(telemetry.position);
  searchedSatelliteMarker.visible = true;
  searchedSatelliteHalo.visible = true;
}

function satPosition(satrec, date) {
  return satelliteTelemetry(satrec, date)?.position ?? null;
}

function satelliteTelemetry(satrec, date) {
  const propagated = satellite.propagate(satrec, date);
  if (!propagated.position) return null;

  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(propagated.position, gmst);
  const geodetic = satellite.eciToGeodetic(propagated.position, gmst);
  const scale = EARTH_RADIUS / EARTH_KM;
  const velocity = propagated.velocity
    ? Math.hypot(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z)
    : null;

  return {
    position: new THREE.Vector3(ecf.x * scale, ecf.z * scale, -ecf.y * scale),
    ecf,
    altitudeKm: geodetic.height,
    latitudeDeg: satellite.degreesLat(geodetic.latitude),
    longitudeDeg: satellite.degreesLong(geodetic.longitude),
    velocityKmS: velocity,
  };
}

function rebuildLabels() {
  for (const label of state.labels) label.remove();
  state.labels = state.displaySats.slice(0, 32).map((sat) => {
    const label = document.createElement("div");
    label.className = "sat-label";
    label.textContent = sat.name.replace(/^STARLINK[- ]/i, "SL-");
    document.body.append(label);
    return label;
  });
  updateLabelVisibility();
}

function updateLabels() {
  if (!state.showLabels) return;

  state.labels.forEach((label, index) => {
    const sat = state.displaySats[index];
    if (!sat?.screenPosition) {
      label.style.display = "none";
      return;
    }

    const projected = sat.screenPosition.clone().project(camera);
    const visible = projected.z < 1 && projected.z > -1;
    label.style.display = visible ? "block" : "none";
    label.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`;
    label.style.top = `${((-projected.y + 1) / 2) * window.innerHeight}px`;
  });
}

function updateLabelVisibility() {
  for (const label of state.labels) {
    label.style.display = state.showLabels && state.viewMode === "3d" ? "block" : "none";
  }
}

function onPointerMove(event) {
  if (state.viewMode !== "3d") return;
  const sat = pickSatellite(event);
  els.canvas.style.cursor = sat ? "pointer" : "grab";

  if (!sat || state.selectedSat) return;
  setReadout("ホバー中", sat.name);
}

function onCanvasClick(event) {
  if (state.viewMode !== "3d") return;
  const sat = pickSatellite(event);
  if (sat) {
    selectSatellite(sat, { focus: false });
  }
}

function pickSatellite(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(satelliteMeshes)[0];
  if (hit?.object?.userData?.sats?.[hit.instanceId]) {
    return hit.object.userData.sats[hit.instanceId];
  }

  let nearest = null;
  let nearestDistance = 14;
  for (const sat of state.visibleSats) {
    if (!sat?.screenPosition) continue;

    const projected = sat.screenPosition.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) continue;

    const x = rect.left + ((projected.x + 1) / 2) * rect.width;
    const y = rect.top + ((-projected.y + 1) / 2) * rect.height;
    const distance = Math.hypot(event.clientX - x, event.clientY - y);
    if (distance < nearestDistance) {
      nearest = sat;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function showSatelliteDetails(sat) {
  const telemetry = sat.telemetry ?? satelliteTelemetry(sat.satrec, state.simulationDate);
  const band = altitudeBand(telemetry?.altitudeKm);
  const altitudeSeries = buildAltitudeSeries(sat.satrec, state.simulationDate);
  const densityProxy = thermosphereProxy(sat);
  const rows = [
    ["衛星名", sat.name],
    ["NORAD番号", sat.satrec.satnum ?? sat.line1.slice(2, 7).trim()],
    ["TLE epoch", formatEpoch(sat.satrec)],
    ["軌道傾斜角", `${THREE.MathUtils.radToDeg(sat.satrec.inclo).toFixed(2)}°`],
    ["平均運動", `${(sat.satrec.no * 1440 / (2 * Math.PI)).toFixed(5)} rev/day`],
    ["BSTAR", formatBstar(sat.satrec.bstar)],
    ["密度proxy", densityProxy ? `${densityProxy.index.toFixed(1)} / 100` : "不明"],
  ];

  if (telemetry) {
    rows.push(
      ["高度", `${telemetry.altitudeKm.toFixed(1)} km`],
      ["高度レイヤー", band.label],
      ["緯度", `${telemetry.latitudeDeg.toFixed(3)}°`],
      ["経度", `${telemetry.longitudeDeg.toFixed(3)}°`],
    );

    if (telemetry.velocityKmS) {
      rows.push(["速度", `${telemetry.velocityKmS.toFixed(3)} km/s`]);
    }
  }

  setDetailReadout("衛星詳細", rows, altitudeSeries);
}

function exportCsvReport() {
  const rows = [];
  const selected = state.selectedSat;
  rows.push(["section", "key", "value"]);
  rows.push(["conditions", "generated_at", new Date().toISOString()]);
  rows.push(["conditions", "simulation_time", state.simulationDate.toISOString()]);
  rows.push(["conditions", "loaded_tle_count", state.satrecs.length]);
  rows.push(["conditions", "displayed_satellite_count", state.displaySats.length]);
  rows.push(["conditions", "show_all_satellites", state.showAllSatellites]);
  rows.push(["conditions", "orbit_line_count", state.orbitLines.length]);
  rows.push(["conditions", "time_speed", `${state.speed}x`]);
  rows.push(["conditions", "color_mode", "altitude_band"]);
  rows.push(["conditions", "density_proxy", "log10(abs(BSTAR)) normalized to 0-100"]);
  rows.push([]);

  rows.push(["selected_satellite", "field", "value"]);
  if (selected) {
    const telemetry = selected.telemetry ?? satelliteTelemetry(selected.satrec, state.simulationDate);
    const proxy = thermosphereProxy(selected);
    rows.push(["selected_satellite", "name", selected.name]);
    rows.push(["selected_satellite", "norad", selected.satrec.satnum]);
    rows.push(["selected_satellite", "altitude_km", telemetry?.altitudeKm ?? ""]);
    rows.push(["selected_satellite", "latitude_deg", telemetry?.latitudeDeg ?? ""]);
    rows.push(["selected_satellite", "longitude_deg", telemetry?.longitudeDeg ?? ""]);
    rows.push(["selected_satellite", "velocity_km_s", telemetry?.velocityKmS ?? ""]);
    rows.push(["selected_satellite", "bstar", selected.satrec.bstar]);
    rows.push(["selected_satellite", "density_proxy_0_100", proxy?.index ?? ""]);
  } else {
    rows.push(["selected_satellite", "name", "none"]);
  }
  rows.push([]);

  rows.push([
    "satellite",
    "name",
    "norad",
    "altitude_km",
    "altitude_band",
    "latitude_deg",
    "longitude_deg",
    "velocity_km_s",
    "bstar",
    "density_proxy_0_100",
  ]);

  for (const sat of state.displaySats) {
    const telemetry = sat.telemetry ?? satelliteTelemetry(sat.satrec, state.simulationDate);
    const proxy = thermosphereProxy(sat);
    rows.push([
      "satellite",
      sat.name,
      sat.satrec.satnum ?? sat.line1.slice(2, 7).trim(),
      telemetry?.altitudeKm?.toFixed(3) ?? "",
      altitudeBand(telemetry?.altitudeKm).label,
      telemetry?.latitudeDeg?.toFixed(6) ?? "",
      telemetry?.longitudeDeg?.toFixed(6) ?? "",
      telemetry?.velocityKmS?.toFixed(6) ?? "",
      Number.isFinite(sat.satrec.bstar) ? sat.satrec.bstar.toExponential(6) : "",
      proxy?.index?.toFixed(3) ?? "",
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(csv, "starlink-report.csv", "text/csv;charset=utf-8");
}

async function exportPngReport() {
  els.exportPngButton.disabled = true;
  try {
    const report = document.createElement("canvas");
    report.width = 1500;
    report.height = 1000;
    const ctx = report.getContext("2d");
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, report.width, report.height);

    drawReportText(ctx);
    drawScenePreview(ctx);
    await drawThermospherePreview(ctx);

    const selected = state.selectedSat;
    if (selected) {
      drawSelectedSatelliteSummary(ctx, selected);
    } else {
      drawTextBlock(ctx, "Selected satellite", ["none"], 1040, 420, 390);
    }

    report.toBlob((blob) => {
      if (blob) downloadBlob(blob, "starlink-report.png", "image/png");
    }, "image/png");
  } finally {
    els.exportPngButton.disabled = false;
  }
}

function drawReportText(ctx) {
  ctx.fillStyle = "#edf7ff";
  ctx.font = "700 42px system-ui, sans-serif";
  ctx.fillText("Starlink Orbit Report", 48, 68);

  const lines = [
    `Generated: ${new Date().toLocaleString("ja-JP", { hour12: false })}`,
    `Simulation time: ${state.simulationDate.toLocaleString("ja-JP", { hour12: false })}`,
    `Loaded TLE: ${state.satrecs.length.toLocaleString()} sats`,
    `Displayed: ${state.displaySats.length.toLocaleString()} sats`,
    `Orbit lines: ${state.orbitLines.length.toLocaleString()}`,
    `Speed: ${state.speed}x`,
    `Density proxy: BSTAR log scale, relative index 0-100`,
  ];
  drawTextBlock(ctx, "Display conditions", lines, 1040, 92, 390);
}

function drawScenePreview(ctx) {
  ctx.fillStyle = "#0b1219";
  roundRect(ctx, 48, 104, 940, 620, 10);
  ctx.fill();
  try {
    const source = state.viewMode === "2d" ? els.map2dCanvas : renderer.domElement;
    ctx.drawImage(source, 48, 104, 940, 620);
  } catch {
    ctx.fillStyle = "#99aebb";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("Scene canvas could not be embedded in this browser.", 84, 400);
  }
  ctx.strokeStyle = "rgba(178,205,221,0.24)";
  ctx.stroke();
}

async function drawThermospherePreview(ctx) {
  const svg = els.thermospherePlot.querySelector("svg");
  if (!svg) {
    drawTextBlock(ctx, "Thermosphere proxy", ["No plot available"], 48, 760, 940);
    return;
  }

  ctx.fillStyle = "#0b1219";
  roundRect(ctx, 48, 760, 940, 190, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(178,205,221,0.24)";
  ctx.stroke();
  ctx.fillStyle = "#edf7ff";
  ctx.font = "700 20px system-ui, sans-serif";
  ctx.fillText("Thermosphere density proxy", 76, 796);

  const image = await svgToImage(svg);
  ctx.drawImage(image, 70, 808, 520, 128);
  const summary = els.thermospherePlot.querySelector(".chart-summary")?.innerText?.split(/\n+/) ?? [];
  drawTextLines(ctx, summary, 640, 830, 300);
}

function drawSelectedSatelliteSummary(ctx, sat) {
  const telemetry = sat.telemetry ?? satelliteTelemetry(sat.satrec, state.simulationDate);
  const proxy = thermosphereProxy(sat);
  const lines = [
    `Name: ${sat.name}`,
    `NORAD: ${sat.satrec.satnum}`,
    `Altitude: ${telemetry?.altitudeKm?.toFixed(1) ?? "-"} km`,
    `Layer: ${altitudeBand(telemetry?.altitudeKm).label}`,
    `Lat/Lon: ${telemetry?.latitudeDeg?.toFixed(3) ?? "-"}, ${telemetry?.longitudeDeg?.toFixed(3) ?? "-"}`,
    `Velocity: ${telemetry?.velocityKmS?.toFixed(3) ?? "-"} km/s`,
    `BSTAR: ${formatBstar(sat.satrec.bstar)}`,
    `Density proxy: ${proxy ? proxy.index.toFixed(1) : "-"} / 100`,
  ];
  drawTextBlock(ctx, "Selected satellite", lines, 1040, 420, 390);
}

function drawTextBlock(ctx, title, lines, x, y, width) {
  ctx.fillStyle = "#0b1219";
  roundRect(ctx, x, y, width, 280, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(178,205,221,0.24)";
  ctx.stroke();
  ctx.fillStyle = "#edf7ff";
  ctx.font = "700 20px system-ui, sans-serif";
  ctx.fillText(title, x + 24, y + 38);
  drawTextLines(ctx, lines, x + 24, y + 72, width - 48);
}

function drawTextLines(ctx, lines, x, y, width) {
  ctx.fillStyle = "#99aebb";
  ctx.font = "16px system-ui, sans-serif";
  let offset = 0;
  for (const line of lines) {
    for (const wrapped of wrapText(ctx, String(line), width)) {
      ctx.fillText(wrapped, x, y + offset);
      offset += 24;
    }
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function svgToImage(svg) {
  return new Promise((resolve, reject) => {
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to render SVG"));
    };
    image.src = url;
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function altitudeBand(altitudeKm) {
  if (!Number.isFinite(altitudeKm)) return ALTITUDE_BANDS[1];
  return ALTITUDE_BANDS.find((band) => altitudeKm < band.max) ?? ALTITUDE_BANDS.at(-1);
}

function thermosphereProxy(sat) {
  const bstar = Number(sat?.satrec?.bstar);
  if (!Number.isFinite(bstar) || bstar === 0) return null;

  const magnitude = Math.abs(bstar);
  const logValue = Math.log10(magnitude);
  const index = THREE.MathUtils.clamp(((logValue + 6.5) / 3.5) * 100, 0, 100);
  return { bstar, magnitude, logValue, index };
}

function formatBstar(value) {
  if (!Number.isFinite(value)) return "不明";
  return value.toExponential(3);
}

function updateThermospherePlot() {
  if (!els.thermospherePlot) return;

  const points = state.displaySats
    .map((sat) => {
      const proxy = thermosphereProxy(sat);
      const altitudeKm = sat.telemetry?.altitudeKm;
      if (!proxy || !Number.isFinite(altitudeKm)) return null;
      return {
        altitudeKm,
        proxy,
        band: altitudeBand(altitudeKm),
      };
    })
    .filter(Boolean);

  els.thermospherePlot.innerHTML = renderThermospherePlot(points);
}

function renderThermospherePlot(points) {
  if (points.length < 2) {
    return "<strong>BSTARが有効な衛星が不足しています</strong>";
  }

  const sampled = sampleArray(points, 260);
  const width = 320;
  const height = 150;
  const pad = { left: 38, right: 12, top: 16, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const minAlt = Math.floor(Math.min(...points.map((point) => point.altitudeKm)) / 50) * 50;
  const maxAlt = Math.ceil(Math.max(...points.map((point) => point.altitudeKm)) / 50) * 50;
  const toX = (altitude) => pad.left + ((altitude - minAlt) / Math.max(maxAlt - minAlt, 1)) * plotWidth;
  const toY = (index) => pad.top + (1 - index / 100) * plotHeight;
  const circles = sampled.map((point) => `
    <circle
      cx="${toX(point.altitudeKm).toFixed(1)}"
      cy="${toY(point.proxy.index).toFixed(1)}"
      r="2.2"
      fill="${hexColor(point.band.color)}"
    ></circle>
  `).join("");
  const values = points.map((point) => point.proxy.index).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const highCount = points.filter((point) => point.proxy.index >= 70).length;

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="BSTAR由来の熱圏密度プロキシ散布図">
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top}" x2="${pad.left + plotWidth}" y2="${pad.top}"></line>
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top + plotHeight / 2}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight / 2}"></line>
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight}"></line>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotHeight}"></line>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight}"></line>
      ${circles}
      <text x="4" y="${pad.top + 4}">high</text>
      <text x="4" y="${pad.top + plotHeight + 4}">low</text>
      <text x="${pad.left}" y="${height - 6}">${minAlt} km</text>
      <text x="${pad.left + plotWidth - 42}" y="${height - 6}">${maxAlt} km</text>
    </svg>
    <div class="chart-summary">
      <span>${points.length.toLocaleString()} sats</span>
      <span>median ${median.toFixed(1)}</span>
      <span>high ${highCount.toLocaleString()}</span>
    </div>
  `;
}

function sampleArray(items, limit) {
  if (items.length <= limit) return items.slice();

  const sampled = [];
  const step = (items.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    sampled.push(items[Math.round(index * step)]);
  }
  return sampled;
}

function hexColor(value) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function formatEpoch(satrec) {
  if (!Number.isFinite(satrec.jdsatepoch)) return "不明";
  return formatDateTime(julianDateToDate(satrec.jdsatepoch));
}

function formatDateTime(date) {
  return date.toLocaleString("ja-JP", { hour12: false });
}

function buildAltitudeSeries(satrec, centerDate) {
  const samples = [];
  const minutesBefore = 90;
  const minutesAfter = 90;
  const stepMinutes = 5;

  for (let minute = -minutesBefore; minute <= minutesAfter; minute += stepMinutes) {
    const date = new Date(centerDate.getTime() + minute * 60 * 1000);
    const telemetry = satelliteTelemetry(satrec, date);
    if (!telemetry) continue;
    samples.push({
      minute,
      altitudeKm: telemetry.altitudeKm,
    });
  }

  return samples;
}

function renderAltitudeChart(samples) {
  if (samples.length < 2) return "";

  const width = 320;
  const height = 132;
  const pad = { left: 36, right: 12, top: 14, bottom: 28 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const minMinute = samples[0].minute;
  const maxMinute = samples.at(-1).minute;
  const minAltitude = Math.floor(Math.min(...samples.map((point) => point.altitudeKm)) / 10) * 10;
  const maxAltitude = Math.ceil(Math.max(...samples.map((point) => point.altitudeKm)) / 10) * 10;
  const altitudeRange = Math.max(maxAltitude - minAltitude, 1);

  const toX = (minute) => pad.left + ((minute - minMinute) / (maxMinute - minMinute)) * plotWidth;
  const toY = (altitude) => pad.top + (1 - ((altitude - minAltitude) / altitudeRange)) * plotHeight;
  const path = samples
    .map((point, index) => `${index === 0 ? "M" : "L"} ${toX(point.minute).toFixed(1)} ${toY(point.altitudeKm).toFixed(1)}`)
    .join(" ");
  const current = samples.find((point) => point.minute === 0) ?? samples[Math.floor(samples.length / 2)];
  const currentX = toX(current.minute);
  const currentY = toY(current.altitudeKm);

  return `
    <div class="altitude-chart">
      <div class="chart-head">
        <span>高度変化</span>
        <strong>前後90分</strong>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="選択衛星の高度変化">
        <line class="chart-grid" x1="${pad.left}" y1="${pad.top}" x2="${pad.left + plotWidth}" y2="${pad.top}"></line>
        <line class="chart-grid" x1="${pad.left}" y1="${pad.top + plotHeight / 2}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight / 2}"></line>
        <line class="chart-grid" x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight}"></line>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotHeight}"></line>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${pad.left + plotWidth}" y2="${pad.top + plotHeight}"></line>
        <path class="chart-line" d="${path}"></path>
        <line class="chart-now" x1="${currentX.toFixed(1)}" y1="${pad.top}" x2="${currentX.toFixed(1)}" y2="${pad.top + plotHeight}"></line>
        <circle class="chart-dot" cx="${currentX.toFixed(1)}" cy="${currentY.toFixed(1)}" r="3.5"></circle>
        <text x="4" y="${pad.top + 4}">${maxAltitude} km</text>
        <text x="4" y="${pad.top + plotHeight + 4}">${minAltitude} km</text>
        <text x="${pad.left}" y="${height - 6}">-90m</text>
        <text x="${currentX - 10}" y="${height - 6}">now</text>
        <text x="${pad.left + plotWidth - 28}" y="${height - 6}">+90m</text>
      </svg>
      <div class="chart-summary">
        <span>min ${minAltitude} km</span>
        <span>current ${current.altitudeKm.toFixed(1)} km</span>
        <span>max ${maxAltitude} km</span>
      </div>
    </div>
  `;
}

function addLatLongLines() {
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x9cd7ee,
    transparent: true,
    opacity: 0.16,
  });

  for (let lat = -60; lat <= 60; lat += 30) {
    const points = [];
    const phi = THREE.MathUtils.degToRad(90 - lat);
    for (let lon = 0; lon <= 360; lon += 4) {
      const theta = THREE.MathUtils.degToRad(lon);
      points.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ));
    }
    earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
  }

  for (let lon = 0; lon < 180; lon += 30) {
    const points = [];
    const theta = THREE.MathUtils.degToRad(lon);
    for (let lat = -90; lat <= 90; lat += 4) {
      const phi = THREE.MathUtils.degToRad(90 - lat);
      points.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ));
    }
    earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
  }
}

function addStars() {
  const positions = [];
  for (let i = 0; i < 1400; i += 1) {
    const radius = 35 + Math.random() * 35;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd8f3ff,
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
  });
  scene.add(new THREE.Points(geometry, material));
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);

  const elapsed = Math.min(now - state.lastFrameTime, 80);
  state.lastFrameTime = now;
  state.simulationDate = new Date(state.simulationDate.getTime() + elapsed * state.speed);

  earthGroup.rotation.y += 0.00018 * (state.speed || 1);
  updateSatellites();
  updateLabels();
  drawMap2d();
  controls.update();
  resize();
  renderer.render(scene, camera);
  els.simTime.textContent = state.simulationDate.toLocaleTimeString("ja-JP", { hour12: false });
}

function resize() {
  const width = els.canvas.clientWidth;
  const height = els.canvas.clientHeight;
  const current = renderer.getSize(new THREE.Vector2());

  if (current.x !== width || current.y !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  if (state.viewMode === "2d") resizeMapCanvas();
}

function setReadout(status, message) {
  const lines = Array.isArray(message) ? message : [message];
  const body = lines.map((line, index) => (
    index === 0
      ? `<strong>${escapeHtml(line)}</strong>`
      : `<small>${escapeHtml(line)}</small>`
  )).join("");
  els.readout.innerHTML = `<span>${escapeHtml(status)}</span><div class="readout-lines">${body}</div>`;
}

function setDetailReadout(status, rows, altitudeSeries = []) {
  const details = rows.map(([label, value]) => `
    <div class="detail-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");
  els.readout.innerHTML = `
    <span>${escapeHtml(status)}</span>
    <dl class="detail-list">${details}</dl>
    ${renderAltitudeChart(altitudeSeries)}
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
