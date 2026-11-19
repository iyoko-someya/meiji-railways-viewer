// 国土数値情報（鉄道時系列 N05-23）の GeoJSON から、1872年〜1912年の路線と駅を、ブラウザの中で取り出して作るプログラム
// data/make_rail_data.py（Python）と同じ処理を、JavaScript にしたもの。
// 利用者が自分で選んだファイルを、この場で加工するだけで、データをどこにも送らない・保存しない。

const FIRST_YEAR = 1872; // この年以降に開業したものを残す
const LAST_YEAR = 1912; // この年までに開業したものを残す
const UNKNOWN_YEAR = 999; // 元データでは、開業年が 999 のものは「不明」を表す
const DECIMALS = 4; // 座標を小数点以下4桁（約10m刻み）に丸める
const TOLERANCE = 0.0001; // 線を単純にするときの許容のずれ（度。約10m）

// ファイルを読んで、地物（路線や駅）のリストを返す。
// 文字は UTF-8 で読み、読めなければ Shift-JIS（文字化けしやすい古い形式）として読み直す
async function readGeojsonFile(file) {
  const buffer = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    text = new TextDecoder("shift_jis").decode(buffer);
  }
  const json = JSON.parse(text);
  if (!Array.isArray(json.features)) {
    throw new Error(t("error.notGeojson", { name: file.name })); // 日本語・英語は i18n.js の訳文
  }
  return json.features;
}

// 開業年の文字列を整数にする。読めないとき、「不明（999）」のとき、対象の年の範囲外のときは null
function toYear(value) {
  const year = parseInt(value, 10);
  if (Number.isNaN(year) || year === UNKNOWN_YEAR) return null;
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  return year;
}

// ダグラス・ポイカー法：線の形がほぼ変わらない範囲で、途中の点を間引く
function simplify(points, tolerance) {
  const n = points.length;
  if (n < 3) return points;
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]]; // まだ調べていない区間［始点の番号, 終点の番号］
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let farthestIndex = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let dist;
      if (length2 === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        // 点 p から、始点と終点を結ぶ線分までの距離
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (dist > farthest) {
        farthest = dist;
        farthestIndex = i;
      }
    }
    if (farthest > tolerance) {
      // 一番遠い点は残して、その前後をさらに調べる
      keep[farthestIndex] = true;
      stack.push([a, farthestIndex]);
      stack.push([farthestIndex, b]);
    }
  }
  return points.filter((point, i) => keep[i]);
}

// 小数点以下 digits 桁に丸める。Math.round だと、ちょうど半分の値の扱いが Python の round と違って結果がずれるので、toFixed を使う
function roundTo(value, digits) {
  return Number(value.toFixed(digits));
}

// 座標を丸めて、同じ点の連続を取り除き、点を間引く
function lighten(coords) {
  const rounded = coords.map(([x, y]) => [roundTo(x, DECIMALS), roundTo(y, DECIMALS)]);
  const result = [rounded[0]];
  for (const point of rounded.slice(1)) {
    const last = result[result.length - 1];
    if (point[0] !== last[0] || point[1] !== last[1]) result.push(point);
  }
  return simplify(result, TOLERANCE);
}

// 駅名の新旧を比べるための値［開始の年, 終了の年］。開始が 999 のものは「1949年以前で不明」なので、一番古い 0 にする
function periodKey(start, end) {
  const s = parseInt(start, 10);
  return [s === UNKNOWN_YEAR ? 0 : s, parseInt(end, 10)];
}

// 2つの値［開始, 終了］を比べる（結果が負なら、a のほうが古い）
function comparePeriod(a, b) {
  return a[0] - b[0] || a[1] - b[1];
}

// 駅名の表示：一番古い名前を主にして、新しい名前を古い順に（）で併記する
function stationDisplayName(namePeriods) {
  const names = [...namePeriods.keys()].sort((a, b) => comparePeriod(namePeriods.get(a), namePeriods.get(b)));
  const newer = names.slice(1);
  return newer.length > 0 ? names[0] + "（" + newer.join("・") + "）" : names[0];
}

// 2つの GeoJSON の地物（路線・駅）のリストから、アプリで使う { lines, stations } を作る
function buildRailData(railFeatures, stationFeatures) {
  const lines = [];
  for (const feature of railFeatures) {
    const p = feature.properties;
    const year = toYear(p.N05_004);
    if (year === null) continue;
    const geometry = feature.geometry;
    // 1本の線も、複数の線のまとまり（MultiLineString）も、線のリストにそろえる
    const parts = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    lines.push({
      name: p.N05_002, // 路線名
      company: p.N05_003, // 運営会社
      type: p.N05_001, // 事業者の種別（コード）
      year: year, // 開業年
      coords: parts.map(lighten),
    });
  }

  // 位置が同じ駅は「同じ駅」として1つにまとめる（開業年は一番早いもの）
  const stationsByPos = new Map();
  for (const feature of stationFeatures) {
    const p = feature.properties;
    const year = toYear(p.N05_004);
    if (year === null) continue;
    const [x, y] = feature.geometry.coordinates;
    const rx = roundTo(x, 5); // 位置が同じかどうかは、小数5桁で比べる
    const ry = roundTo(y, 5);
    const key = rx + "," + ry;
    let station = stationsByPos.get(key);
    if (!station) {
      station = { names: new Map(), lines: [], year: year, lon: rx, lat: ry };
      stationsByPos.set(key, station);
    } else if (year < station.year) {
      station.year = year;
    }
    // 駅名ごとに、その名前だった期間を覚えておく。新旧の判定に使う
    const period = periodKey(p.N05_005b, p.N05_005e);
    const name = p.N05_011;
    if (!station.names.has(name) || comparePeriod(period, station.names.get(name)) < 0) {
      station.names.set(name, period);
    }
    // この駅に、路線ごとの開業年を記録する（同じ路線が重複していたら早い年を残す）
    const same = station.lines.find((item) => item.name === p.N05_002 && item.company === p.N05_003);
    if (same) {
      same.year = Math.min(same.year, year);
    } else {
      station.lines.push({ name: p.N05_002, company: p.N05_003, type: p.N05_001, year: year });
    }
  }

  const stations = [];
  for (const station of stationsByPos.values()) {
    station.lines.sort((a, b) => a.year - b.year); // 古い順に並べる
    stations.push({
      name: stationDisplayName(station.names),
      lines: station.lines,
      year: station.year,
      lon: roundTo(station.lon, DECIMALS),
      lat: roundTo(station.lat, DECIMALS),
    });
  }
  return { lines, stations };
}

// 動作確認用：node から読み込んだときだけ、関数を取り出せるようにする（ブラウザでは何も起きない）
if (typeof module !== "undefined") module.exports = { buildRailData };
