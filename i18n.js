// 日本語・英語の切り替え用の「訳文の一覧」と、訳文を取り出す関数 t()
// ページの固定の文章は index.html に、日本語（lang="ja"）と英語（lang="en"）の両方を書いてある。
// ここには、プログラム（app.js・build-data.js）が画面に出す文章だけを入れる。
// 文章の中の {名前} は、t() を呼ぶときに渡した値に置き換わる。

const MESSAGES = {
  ja: {
    "page.title": "Meiji Railways Viewer (1872-1912)",
    "lang.button": "English", // ボタンには、切り替え先の言語の名前を出す
    "lang.buttonLabel": "表示言語を英語に切り替える",
    "play.start": "▶ 再生",
    "play.stop": "⏸ 停止",
    "counts": "選択された路線 {routes} 本 / 駅 {stations} 件",
    "status.none": "データが読み込まれていません",
    "status.loaded": "読み込み済み",
    "status.processing": "処理中です。数秒かかります…（データは、このブラウザの中だけで加工します）",
    "search.placeholder": "駅名・路線名で検索",
    "legend.jnr": "旧国鉄",
    "legend.other": "旧国鉄以外",
    "layer.pale": "淡色地図",
    "layer.blank": "白地図",
    "attribution.gsi": "国土地理院",
    "attribution.rail": "国土交通省 国土数値情報（鉄道時系列データ）を加工して作成",
    "popup.stationOpened": "駅の開業年：{year}年",
    "popup.stationLines": "通る路線（路線ごとの開業年）：",
    "popup.lineItem": "{name}（{company}）{year}年",
    "popup.company": "{company}（{type}）",
    "popup.jnr": "旧国鉄",
    "popup.other": "旧国鉄以外",
    "popup.routeOpened": "路線の開業年：{year}年",
    "popup.sectionOpened": "この区間の開業年：{year}年",
    "search.station": "駅",
    "search.route": "路線",
    "search.year": "{year}年",
    "search.more": "ほか {n} 件（もっと絞り込んでください）",
    "error.needTwoFiles": "N05-22_RailroadSection2.geojson と N05-22_Station2.geojson の2つを、いっしょに選んでください。",
    "error.readFailed": "ファイルを読み込めませんでした。（{message}）",
    "error.notGeojson": "国土数値情報の GeoJSON ではありません（{name}）",
  },
  en: {
    "page.title": "Meiji Railways Viewer (1872-1912)",
    "lang.button": "日本語",
    "lang.buttonLabel": "Switch the display language to Japanese",
    "play.start": "▶ Play",
    "play.stop": "⏸ Stop",
    "counts": "Selected: {routes} routes / {stations} stations",
    "status.none": "No data loaded",
    "status.loaded": "Data loaded",
    "status.processing": "Processing. This takes a few seconds… (the data is processed only inside this browser)",
    "search.placeholder": "Search by station or route name",
    "legend.jnr": "Former JNR",
    "legend.other": "Other railways",
    "layer.pale": "Pale map",
    "layer.blank": "Blank map",
    "attribution.gsi": "Geospatial Information Authority of Japan",
    "attribution.rail": "Processed from MLIT Digital National Land Information (Railway Time-series Data)",
    "popup.stationOpened": "Station opened: {year}",
    "popup.stationLines": "Lines serving this station (opening year of each line):",
    "popup.lineItem": "{name} ({company}), {year}",
    "popup.company": "{company} ({type})",
    "popup.jnr": "Former JNR",
    "popup.other": "Other railways",
    "popup.routeOpened": "Route opened: {year}",
    "popup.sectionOpened": "This section opened: {year}",
    "search.station": "Station",
    "search.route": "Route",
    "search.year": "{year}",
    "search.more": "{n} more (please narrow down your search)",
    "error.needTwoFiles": "Please select both N05-22_RailroadSection2.geojson and N05-22_Station2.geojson at the same time.",
    "error.readFailed": "Could not read the files. ({message})",
    "error.notGeojson": "Not a Digital National Land Information GeoJSON file ({name})",
  },
};

// いまの言語。前に選んだ言語がブラウザに残っていれば、それを使う（なければ日本語）
let currentLang = "ja";
try {
  const saved = localStorage.getItem("lang");
  if (saved === "ja" || saved === "en") currentLang = saved;
} catch (e) {
  // 保存した言語が読めなくても、日本語で続ける
}

// 訳文を取り出す。t("counts", { routes: 3, stations: 5 }) のように使う
function t(key, params = {}) {
  const text = MESSAGES[currentLang][key] ?? MESSAGES.ja[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
}
