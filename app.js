// 鉄道ネットワークの地図を表示するプログラム
// 年のスライダーで選んだ年までに開業した路線（区間）と駅だけを、地図に表示する。

const errorEl = document.getElementById("error");
const slider = document.getElementById("year-slider");
const yearLabel = document.getElementById("year-label");
const countsEl = document.getElementById("counts");
const playButton = document.getElementById("play-button");
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");

// 1. 地図を作る。最初は日本全体が見える位置と拡大率にする
//    preferCanvas: 線や点が多いので、軽い描き方（canvas）を使う
//    minZoom: 縮小できる限度（数字が小さいほど、広い範囲まで縮小できる）
const map = L.map("map", { preferCanvas: true, minZoom: 4 }).setView([37.5, 137.0], 5);

// 路線の色：旧国鉄とそれ以外で分ける
const JNR_COLOR = "#266EBD"; // 旧国鉄（青）
const OTHER_COLOR = "#E67E22"; // 旧国鉄以外（オレンジ）

// 凡例：地図の左下に、色の意味を表示する
const legend = L.control({ position: "bottomleft" });
let legendDiv = null;
legend.onAdd = () => {
  legendDiv = L.DomUtil.create("div", "legend");
  renderLegend();
  return legendDiv;
};
// 凡例の文字を、いまの言語で書く（言語を切り替えたときにも呼ぶ）
function renderLegend() {
  legendDiv.innerHTML =
    '<div><span class="legend-line" style="background:' + JNR_COLOR + '"></span>' + t("legend.jnr") + "</div>" +
    '<div><span class="legend-line" style="background:' + OTHER_COLOR + '"></span>' + t("legend.other") + "</div>";
}
legend.addTo(map);

// 駅の点は、路線の線より上に重ねて描く（専用の層を作って、重なる順番を線より上にする）
map.createPane("stations");
map.getPane("stations").style.zIndex = 450;

// 2. 背景の地図（国土地理院）を2種類用意する。右上のボタンで切り替えられる
//    画像の拡大率には上限があり、それより拡大したときは、上限の画像を引き伸ばして使う
function gsiAttribution() {
  return '<a href="https://maps.gsi.go.jp/development/ichiran.html">' + t("attribution.gsi") + "</a>";
}

// 淡色地図：色が薄く、路線が見やすい
const paleLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  maxNativeZoom: 18,
  maxZoom: 18,
  attribution: gsiAttribution(),
});

// 白地図：海岸線や行政界だけの、白い地図
const blankLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
  maxNativeZoom: 14,
  maxZoom: 18,
  attribution: gsiAttribution(),
});

// 地図の右下に出る出典の表示に、鉄道データの出典を足す（Leaflet と国土地理院は、自動で出る）
function railAttribution() {
  return (
    '<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N05-v2_0.html" target="_blank" rel="noopener">' +
    t("attribution.rail") + "</a>"
  );
}
let currentRailAttribution = railAttribution();
map.attributionControl.addAttribution(currentRailAttribution);

blankLayer.addTo(map); // 最初に表示する背景（白地図）

// 背景の切り替えボタン。名前を言語ごとに変えるため、切り替えのたびに作り直す
let layersControl = null;
function renderLayersControl() {
  if (layersControl) layersControl.remove();
  layersControl = L.control.layers({ [t("layer.pale")]: paleLayer, [t("layer.blank")]: blankLayer }).addTo(map);
}
renderLayersControl();

// 3. 年ごとの「地図に描く部品」を入れておく入れ物
//    年 → { routes: その年に初めて開業した路線の数, polylines: 線の部品のリスト,
//           stations: 駅の数, markers: 点の部品のリスト }
//    部品は最初に作っておくだけで、地図にはまだ載せない。スライダーで年が進んだときに載せる
const itemsByYear = new Map();
const firstYear = Number(slider.min);
const lastYear = Number(slider.max);
for (let year = firstYear; year <= lastYear; year++) {
  itemsByYear.set(year, { routes: 0, polylines: [], stations: 0, markers: [] });
}

// いま地図に載せている年。まだ何も載せていないときは null
let shownYear = null;

// 検索用の一覧。データを読み込むときに、中身を入れる
const searchStations = []; // { station: 駅のデータ, marker: 地図の点 }
const searchRoutes = []; //   { name, company, firstYear, sections: [{ year, polylines }] }

// 4. 鉄道のデータを準備する
//    手元（data/rail-1872-1913.json がある）ときは、それを自動で読み込む。
//    ないとき（公開したページなど）は、右上の読み込み欄で、国土数値情報から取得したファイルを、自分で選んで読み込む
const dataFilesInput = document.getElementById("data-files");
const dataStatusEl = document.getElementById("data-status");

// 読み込み欄の状態表示："none"（未読み込み）・"loaded"（読み込み済み）・"processing"（処理中）。言語を切り替えても、同じ状態を書き直せるように覚えておく
let dataStatus = "none";
function setStatus(state) {
  dataStatus = state;
  dataStatusEl.textContent = t("status." + state);
}
setStatus("none");

// 読み込んだデータで、地図の部品を作って、スライダーなどを使えるようにする
let hasData = false; // 読み込み済みのデータがあるか
function startWithData(data) {
  hasData = true;
  prepareLines(data.lines);
  prepareStations(data.stations);
  slider.disabled = false; // データの準備ができたので、スライダー・再生ボタン・検索欄を使えるようにする
  playButton.disabled = false;
  searchInput.disabled = false;
  setStatus("loaded");
  showYear(Number(slider.value));
}

// 読み込み済みのデータを、すべて消して、最初の状態に戻す（新しいファイルを読み込み直すときに使う）
function clearData() {
  stopPlaying(); // 再生中なら止める
  map.closePopup(); // 開いているポップアップを閉じる
  for (const [year, items] of itemsByYear) {
    for (const layer of [...items.polylines, ...items.markers]) layer.remove(); // 地図から外す
    itemsByYear.set(year, { routes: 0, polylines: [], stations: 0, markers: [] });
  }
  searchStations.length = 0;
  searchRoutes.length = 0;
  shownYear = null; // 次の showYear で、最初の年から載せ直す
  searchResultsEl.hidden = true; // 検索の候補も消す
  searchResultsEl.textContent = "";
}

// エラーのメッセージを出す
// （言語を切り替えたときに書き直せるように、キーと値を覚えておく）
let lastError = null;
function showError(key, params) {
  lastError = { key, params };
  errorEl.textContent = t(key, params);
  errorEl.hidden = false;
}

fetch("data/rail-1872-1913.json")
  .then((response) => {
    if (!response.ok) {
      throw new Error("データが読み込めませんでした（状態 " + response.status + "）");
    }
    return response.json();
  })
  .then(startWithData, () => {
    // データのファイルがないときは、何もしない（右上の読み込み欄で、ファイルを選んでもらう）
  });

// 利用者がファイルを選んだとき：路線と駅の GeoJSON を見分けて、加工して、地図に表示する
dataFilesInput.addEventListener("change", async () => {
  const files = [...dataFilesInput.files];
  const railFile = files.find((f) => f.name.includes("RailroadSection"));
  const stationFile = files.find((f) => f.name.includes("Station"));
  errorEl.hidden = true;
  lastError = null;
  if (!railFile || !stationFile) {
    showError("error.needTwoFiles");
    return;
  }
  dataFilesInput.disabled = true; // 処理中に、もう一度選ばれないようにする
  const previousStatus = hasData ? "loaded" : "none";
  setStatus("processing");
  try {
    const railFeatures = await readGeojsonFile(railFile);
    const stationFeatures = await readGeojsonFile(stationFile);
    const data = buildRailData(railFeatures, stationFeatures); // 失敗したときに、いまのデータが消えないよう、先に加工する
    clearData(); // 前のデータを消してから、新しいデータを載せる
    startWithData(data);
  } catch (error) {
    showError("error.readFailed", { message: error.message });
    setStatus(previousStatus);
  } finally {
    dataFilesInput.disabled = false; // いつでも、選び直せるようにする
    dataFilesInput.value = ""; // 同じファイルを選び直しても、反応するようにする
  }
});

// 路線（線）の部品を、開業年ごとの入れ物に入れる
function prepareLines(lines) {
  // 元データの線は「区間」で、1つの路線が開業年ごとに何本もの区間に分かれている。
  // そこで、路線の数を数えるために、「運営会社＋路線名」が同じ区間を、同じ路線とみなす。
  // 路線ごとに、{ 路線名, 運営会社, 一番早い区間の開業年, 区間のリスト } をまとめる
  const routes = new Map();

  for (const line of lines) {
    const items = itemsByYear.get(line.year);
    if (!items) continue; // スライダーの範囲外の年は使わない

    const routeKey = line.company + "／" + line.name;
    let route = routes.get(routeKey);
    if (!route) {
      route = {
        name: line.name,
        company: line.company,
        isJnr: line.type === "2", // 事業者の種別が "2" のものが、旧国鉄（JR・日本国有鉄道）
        firstYear: line.year,
        sections: [],
      };
      routes.set(routeKey, route);
    }
    route.firstYear = Math.min(route.firstYear, line.year);

    // この区間の線の部品を入れておく。検索で路線を選んだとき、地図をその場所に動かすために使う
    const section = { year: line.year, polylines: [] };
    route.sections.push(section);

    // 1つの区間は、線のかたまりが複数あることがある（coords は「線のリスト」）
    for (const part of line.coords) {
      // データは [経度, 緯度] の順。Leaflet は [緯度, 経度] の順なので入れ替える
      const latlngs = part.map(([lon, lat]) => [lat, lon]);
      // 線の太さは、地図に載せるとき・拡大率が変わったときに、setLineWeight で決める
      const polyline = L.polyline(latlngs, { color: route.isJnr ? JNR_COLOR : OTHER_COLOR });
      // クリックされたときに、ポップアップを出す（内容は、開いたときに作る）
      polyline.bindPopup(() => routePopupHtml(route, line.year));
      items.polylines.push(polyline);
      section.polylines.push(polyline);
    }
  }

  // 路線が初めて現れる年ごとに、路線の数を数える。検索用の一覧にも入れる
  for (const route of routes.values()) {
    itemsByYear.get(route.firstYear).routes += 1;
    searchRoutes.push(route);
  }
}

// 駅（点）の部品を、開業年ごとの入れ物に入れる
function prepareStations(stations) {
  for (const station of stations) {
    const items = itemsByYear.get(station.year);
    if (!items) continue;
    items.stations += 1;
    // 点の大きさと色は、地図に載せるとき・拡大率や年が変わったときに、stationStyle で決める
    const marker = L.circleMarker([station.lat, station.lon], {
      pane: "stations", // 線より上の層に描く
    });
    // クリックされたときに、ポップアップを出す（内容は、開いたときに作る）
    marker.bindPopup(() => stationPopupHtml(station));
    // 地図に表示する駅名。「黒沢尻（北上）」のような長い名前は、（）の前の名前だけにする
    marker.stationLabel = station.name.split("（")[0];
    items.markers.push(marker);
    searchStations.push({ station, marker }); // 検索用の一覧にも入れる
  }

  // 駅名を出す優先順位を決める：通る路線が多い駅（乗換駅）→ 開業が早い駅 の順に、0 以上 1 未満の順位を付ける
  //（順位が小さいほど先に駅名が出る。updateStationLabels で使う）
  const ordered = [...searchStations].sort(
    (a, b) => b.station.lines.length - a.station.lines.length || a.station.year - b.station.year
  );
  ordered.forEach(({ marker }, i) => {
    marker.labelRank = i / ordered.length;
  });
}

// ポップアップに文字を入れるときは、「<」などの特別な文字が HTML として解釈されないように変換する
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 駅のポップアップの中身：駅名・開業年・通る路線（路線ごとの開業年つき）
function stationPopupHtml(station) {
  const lineItems = station.lines
    .map((l) => "<li>" + t("popup.lineItem", { name: escapeHtml(l.name), company: escapeHtml(l.company), year: l.year }) + "</li>")
    .join("");
  return (
    "<strong>" + escapeHtml(station.name) + "</strong><br>" +
    t("popup.stationOpened", { year: station.year }) + "<br>" +
    t("popup.stationLines") + "<ul>" + lineItems + "</ul>"
  );
}

// 路線（区間）のポップアップの中身：路線名・運営会社・開業年
function routePopupHtml(route, sectionYear) {
  return (
    "<strong>" + escapeHtml(route.name) + "</strong><br>" +
    t("popup.company", { company: escapeHtml(route.company), type: route.isJnr ? t("popup.jnr") : t("popup.other") }) + "<br>" +
    t("popup.routeOpened", { year: route.firstYear }) + "<br>" +
    t("popup.sectionOpened", { year: sectionYear })
  );
}

// 5. 選んだ年までのものだけを、地図に表示する
//    全部を描き直すと重いので、前回の年からの「差」だけを、載せたり外したりする
//    isPlaying が true（再生中）のときは、重い駅名の更新を省く（再生が止まったときにまとめて行う）
function showYear(year, isPlaying = false) {
  const previousYear = shownYear; // 前回の年（最初は null）
  shownYear = year; // 点の色（その年に開業した駅か）を決めるために、先に更新しておく
  newLineOpacity = isPlaying ? 0 : 1; // ふだんは新設区間もはっきり表示。再生中は透明から始めて、少しずつ増やす

  if (previousYear === null) {
    // 最初は、最初の年から選んだ年までを、すべて載せる
    for (let y = firstYear; y <= year; y++) setYearVisible(y, true);
  } else if (year > previousYear) {
    // 年が進んだ：増えた年の分を載せる
    for (let y = previousYear + 1; y <= year; y++) setYearVisible(y, true);
  } else if (year < previousYear) {
    // 年が戻った：減った年の分を外す
    for (let y = year + 1; y <= previousYear; y++) setYearVisible(y, false);
  }

  // 太く表示する線（その年に開業した新設区間）を更新する：前回の年の線は元の太さに戻し、今回の年の線は太くする
  if (previousYear !== null && previousYear <= year) restyleLines(previousYear);
  restyleLines(year);

  if (!isPlaying) updateStationLabels(); // 拡大しているときは、新しく載せた駅の駅名も表示する

  updateLabels(year);
}

// その年に開業した新設区間の、不透明度（0 = 透明 〜 1 = はっきり）。再生中、ふわっと現れるために使う
let newLineOpacity = 1;

// ある年に開業した線と点を、地図に載せる（visible が true）か、外す（false）
function setYearVisible(year, visible) {
  const items = itemsByYear.get(year);
  if (visible) {
    // 載せる前に、いまの拡大率と年に合った見た目にしておく
    restyleLines(year);
    restyleMarkers(year);
  }
  for (const layer of [...items.polylines, ...items.markers]) {
    if (visible) {
      layer.addTo(map);
    } else {
      layer.remove();
    }
  }
  if (!visible) {
    // 外す駅の駅名の設定も取り除く（取り除かないと、次に載せたときに駅名が勝手に出てしまう）
    for (const marker of items.markers) marker.unbindTooltip();
  }
}

// 6. 拡大率に合わせた、線の太さと点の大きさ
//    縮小しているときは細く・小さく、拡大するほど太く・大きくする

// 線の太さ：拡大率4で1、拡大率が1上がるごとに0.5ずつ太くして、5まで
function lineWeight() {
  return Math.min(5, Math.max(1, 1 + (map.getZoom() - 4) * 0.5));
}

// その年に開業した新設区間は、ほかの線の何倍の太さで表示するか
const NEW_LINE_SCALE = 2;

// 点の半径：拡大率5以下では0（表示しない）、拡大率が1上がるごとに1.2ずつ大きくして、7まで。
// 日本全体が見える縮小したときは、点が目立たないようにする
function stationRadius() {
  return Math.min(7, Math.max(0, (map.getZoom() - 5) * 1.2));
}

// 駅の点の見た目：白い点。半径が小さいときは、枠を細くする。半径が1未満のときは、描かない
function stationStyle() {
  const radius = stationRadius();
  if (radius < 1) {
    // 描かない：線も塗りも透明にして、半径も0にする（半径0なので、クリックにも反応しない）
    return { radius: 0, opacity: 0, fillOpacity: 0 };
  }
  return {
    radius: radius,
    color: "#222",
    weight: radius < 2 ? 0.5 : 1,
    opacity: 1,
    fillColor: "#fff",
    fillOpacity: 1,
  };
}

// ある年に開業した線の太さを、いまの拡大率と年に合わせる。いま選んでいる年の線は、太くする
function restyleLines(year) {
  const isNew = year === shownYear;
  for (const polyline of itemsByYear.get(year).polylines) {
    polyline.setStyle({
      weight: isNew ? lineWeight() * NEW_LINE_SCALE : lineWeight(),
      opacity: isNew ? newLineOpacity : 1,
    });
    // 太い線は、ほかの線に隠れないように、一番上に出す
    if (isNew && map.hasLayer(polyline)) polyline.bringToFront();
  }
}

// ある年に開業した駅の点の見た目を、いまの拡大率に合わせる
function restyleMarkers(year) {
  for (const marker of itemsByYear.get(year).markers) {
    marker.setStyle(stationStyle());
  }
}

// 駅名を表示し始める拡大率。この拡大率以上に拡大したときだけ、駅名を出す
const LABEL_ZOOM = 6; // 駅の点が出始める拡大率（6）と同じ。拡大率が6以上のとき、駅名を出す

// 拡大率ごとの、駅名を出す駅の割合。拡大するほど割合が増え、少しずつ駅名が増える（増やしすぎると重くなる）
const LABEL_FRACTIONS = { 6: 0.03, 7: 0.1, 8: 0.25, 9: 0.5, 10: 0.8, 11: 1 };
function labelFractionAtZoom(zoom) {
  if (zoom < LABEL_ZOOM) return 0;
  return LABEL_FRACTIONS[Math.min(Math.floor(zoom), 11)] ?? 0; // 拡大率が小数のときは、切り捨てた値で決める
}

// 駅名の表示を更新する。拡大していて、画面に入っている駅だけに駅名を付ける。
// （全部の駅に付けると重くなるので、画面に入っているものだけにする）
function updateStationLabels() {
  if (shownYear === null) return; // まだデータを読み込んでいないとき
  const labelFraction = labelFractionAtZoom(map.getZoom()); // 駅名を出す駅の割合（0〜1）
  const bounds = map.getBounds().pad(0.1); // 画面より少し広い範囲
  for (let y = firstYear; y <= shownYear; y++) {
    for (const marker of itemsByYear.get(y).markers) {
      const shouldShow = marker.labelRank < labelFraction && bounds.contains(marker.getLatLng());
      const hasLabel = Boolean(marker.getTooltip());
      if (shouldShow && !hasLabel) {
        // permanent: true は、マウスを乗せなくても、ずっと表示する設定
        marker.bindTooltip(marker.stationLabel, {
          permanent: true,
          direction: "right",
          offset: [6, 0],
          className: "station-label",
        });
      } else if (!shouldShow && hasLabel) {
        marker.unbindTooltip();
      }
    }
  }
}

// 拡大・縮小が終わったとき、いま表示している線と点の見た目を、新しい拡大率に合わせ直す
map.on("zoomend", () => {
  if (shownYear === null) return; // まだデータを読み込んでいないとき
  for (let y = firstYear; y <= shownYear; y++) {
    restyleLines(y);
    restyleMarkers(y);
  }
  updateStationLabels();
});

// 地図を動かし終わったときも、新しく画面に入った駅に、駅名を付ける
map.on("moveend", updateStationLabels);

// 年の表示と、「選択された路線／駅」の件数を更新する
function updateLabels(year) {
  let routeCount = 0;
  let stationCount = 0;
  for (let y = firstYear; y <= year; y++) {
    routeCount += itemsByYear.get(y).routes;
    stationCount += itemsByYear.get(y).stations;
  }
  yearLabel.textContent = year;
  renderCounts(routeCount, stationCount);
}

// 「選択された路線／駅」の件数を、いまの言語で書く。言語を切り替えたとき用に、数を覚えておく
let lastCounts = { routes: 0, stations: 0 };
function renderCounts(routes, stations) {
  lastCounts = { routes, stations };
  countsEl.textContent = t("counts", { routes, stations });
}

// スライダーを動かしている間も、動かすたびに地図を更新する
slider.addEventListener("input", () => {
  stopPlaying(); // 自分で動かしたときは、自動再生を止める
  showYear(Number(slider.value));
});

// 6. 再生ボタン：年を1つずつ自動で進めて、変化をアニメーションのように見せる
//    setInterval だと、年が切り替わる瞬間に線が「ぱっ」と現れてカクカクして見える。
//    そこで、画面の描き換えに合わせて呼ばれる requestAnimationFrame を使い、
//    新しい年の線を、年の前半でふわっと（透明から不透明へ）表示する。
const PLAY_INTERVAL_MS = 500; // 1年進むまでの時間（ミリ秒）。数字を小さくすると速くなる
const FADE_RATIO = 0.6; // 1年の時間のうち、ふわっと現れる時間の割合（0〜1）
let playing = false; // 再生中かどうか
let playFrameId = null; // 次の描き換えの予約番号（止めるときに使う）
let yearStartedAt = 0; // いまの年に切り替わった時刻（ミリ秒）

function playFrame(now) {
  if (!playing) return;

  // 1年分の時間がたったら、次の年に進む
  if (now - yearStartedAt >= PLAY_INTERVAL_MS) {
    const next = Number(slider.value) + 1;
    slider.value = next;
    showYear(next, true);
    yearStartedAt = now;
    if (next >= lastYear) {
      stopPlaying(); // 最後の年まで来たら、自動で止まる
      return;
    }
  }

  // 新しい年の線の不透明度を、0 → 1 へ少しずつ変える（変わったときだけ描き直す）
  const progress = Math.min(1, (now - yearStartedAt) / (PLAY_INTERVAL_MS * FADE_RATIO));
  if (progress !== newLineOpacity) {
    newLineOpacity = progress;
    restyleLines(shownYear);
  }
  playFrameId = requestAnimationFrame(playFrame);
}

function startPlaying() {
  // 最後の年で押したときは、最初の年に戻ってから再生する
  if (Number(slider.value) >= lastYear) {
    slider.value = firstYear;
    showYear(firstYear);
  }
  playButton.textContent = t("play.stop");
  playing = true;
  yearStartedAt = performance.now();
  playFrameId = requestAnimationFrame(playFrame);
}

function stopPlaying() {
  const wasPlaying = playing;
  playing = false;
  cancelAnimationFrame(playFrameId);
  playButton.textContent = t("play.start");
  if (wasPlaying && shownYear !== null) {
    newLineOpacity = 1; // 途中で止めても、線が半透明のままにならないようにする
    restyleLines(shownYear);
    updateStationLabels(); // 再生中に省いていた駅名の更新を行う
  }
}

playButton.addEventListener("click", () => {
  if (!playing) {
    startPlaying();
  } else {
    stopPlaying();
  }
});

// 7. 検索：駅名・路線名の一部を入力すると、候補が出る。選ぶと地図がその場所に動き、ポップアップが開く
const MAX_RESULTS = 30; // 候補として表示する最大の件数

// 入力された文字を含む駅・路線を探して、候補のリストを作る
function search(query) {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const results = [];
  for (const { station, marker } of searchStations) {
    const name = station.name.toLowerCase();
    if (!name.includes(q)) continue;
    results.push({
      kind: "station",
      name: station.name,
      year: station.year,
      detail: station.lines.map((l) => l.name).join("・"), // 通る路線名
      starts: name.startsWith(q),
      station,
      marker,
    });
  }
  for (const route of searchRoutes) {
    const name = route.name.toLowerCase();
    if (!name.includes(q)) continue;
    results.push({
      kind: "route",
      name: route.name,
      year: route.firstYear,
      detail: route.company,
      starts: name.startsWith(q),
      route,
    });
  }

  // 並べ方：名前が入力で始まるものを先に、次に開業年が早い順、最後に名前順
  results.sort(
    (a, b) => Number(b.starts) - Number(a.starts) || a.year - b.year || a.name.localeCompare(b.name, "ja")
  );
  return results;
}

// 候補のリストを画面に表示する
function showResults(results) {
  searchResultsEl.textContent = ""; // 前の候補を消す
  if (results.length === 0) {
    // 空欄のときも、見つからなかったときも、何も表示しない（候補のリストを隠す）
    searchResultsEl.hidden = true;
    return;
  }

  for (const result of results.slice(0, MAX_RESULTS)) {
    const li = document.createElement("li");
    // 1行を、4つのセル（区切られたマス）で表示する：種別｜名前｜開業年｜路線名（路線のときは運営会社）
    // 例：「駅 ｜ 品川 ｜ 1872年 ｜ 東海道線・山手線」
    const cells = [
      { text: t("search." + result.kind), className: "cell-kind " + (result.kind === "station" ? "kind-station" : "kind-route") },
      { text: result.name, className: "cell-name" },
      { text: t("search.year", { year: result.year }), className: "cell-year" },
      { text: result.detail, className: "cell-detail" },
    ];
    for (const cell of cells) {
      const span = document.createElement("span");
      span.className = "cell " + cell.className;
      span.textContent = cell.text;
      li.appendChild(span);
    }
    li.addEventListener("click", () => goToResult(result));
    searchResultsEl.appendChild(li);
  }
  if (results.length > MAX_RESULTS) {
    const li = document.createElement("li");
    li.className = "no-result";
    li.textContent = t("search.more", { n: results.length - MAX_RESULTS });
    searchResultsEl.appendChild(li);
  }
  searchResultsEl.hidden = false;
}

// 候補を選んだとき：地図をその場所に動かして、ポップアップを開く
function goToResult(result) {
  // 選んだ駅・路線が、いま選んでいる年より後に開業していると、地図には出ていない。
  // その場合は、開業した年までスライダーを進めて、表示されるようにする
  if (result.year > Number(slider.value)) {
    stopPlaying();
    slider.value = result.year;
    showYear(result.year);
  }

  if (result.kind === "station") {
    map.setView(result.marker.getLatLng(), Math.max(map.getZoom(), 12));
    result.marker.openPopup();
  } else {
    // いま表示されている年までの区間を、すべて画面に収める
    const shown = result.route.sections.filter((s) => s.year <= Number(slider.value));
    const lines = shown.flatMap((s) => s.polylines);
    map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [40, 40], maxZoom: 12 });
    // ポップアップは、一番早い区間の線の真ん中あたりに出す
    const first = shown.reduce((a, b) => (b.year < a.year ? b : a));
    const points = first.polylines[0].getLatLngs();
    first.polylines[0].openPopup(points[Math.floor(points.length / 2)]);
  }
  searchResultsEl.hidden = true; // 候補のリストを閉じる
}

// 入力するたびに、候補を更新する
searchInput.addEventListener("input", () => {
  showResults(search(searchInput.value));
});

// キーボード操作：Enter で一番上の候補を選ぶ、Esc で候補を閉じる
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const results = search(searchInput.value);
    if (results.length > 0) goToResult(results[0]);
  } else if (event.key === "Escape") {
    searchResultsEl.hidden = true;
  }
});

// 入力欄をクリックしたとき、前の入力が残っていれば候補を出し直す
searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim() !== "") showResults(search(searchInput.value));
});

// 検索欄の外をクリックしたら、候補を閉じる
document.addEventListener("click", (event) => {
  if (!event.target.closest("#search-box")) searchResultsEl.hidden = true;
});

// 8. 言語の切り替え（日本語 ⇔ English）
//    ページの固定の文章は、HTML に両方の言語を書いてあり、<html lang> の値で、どちらかを隠している（style.css）。
//    ここでは、プログラムが作る文章（件数・凡例・ポップアップなど）を、いまの言語で書き直す。
//    駅名・路線名・運営会社名は、元データの日本語のまま表示する。
const langButton = document.getElementById("lang-button");

function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.title = t("page.title");
  langButton.textContent = t("lang.button");
  langButton.setAttribute("aria-label", t("lang.buttonLabel"));
  searchInput.placeholder = t("search.placeholder");
  if (playing) {
    playButton.textContent = t("play.stop");
  } else {
    playButton.textContent = t("play.start");
  }
  setStatus(dataStatus);
  renderCounts(lastCounts.routes, lastCounts.stations);
  if (lastError) showError(lastError.key, lastError.params);
  renderLegend();
  renderLayersControl();

  // 背景地図と鉄道データの出典（右下）を、いまの言語に差し替える
  for (const layer of [paleLayer, blankLayer]) {
    const onMap = map.hasLayer(layer);
    if (onMap) map.attributionControl.removeAttribution(layer.options.attribution);
    layer.options.attribution = gsiAttribution();
    if (onMap) map.attributionControl.addAttribution(layer.options.attribution);
  }
  map.attributionControl.removeAttribution(currentRailAttribution);
  currentRailAttribution = railAttribution();
  map.attributionControl.addAttribution(currentRailAttribution);

  map.closePopup(); // 開いているポップアップは、古い言語のままなので閉じる
  if (!searchResultsEl.hidden) showResults(search(searchInput.value)); // 検索の候補も書き直す
}

langButton.addEventListener("click", () => {
  currentLang = currentLang === "ja" ? "en" : "ja";
  try {
    localStorage.setItem("lang", currentLang); // 次に開いたときも、同じ言語で表示する
  } catch (e) {
    // 保存できなくても、切り替えは行う
  }
  applyLanguage();
});

applyLanguage(); // 最初の表示も、前に選んだ言語に合わせる
