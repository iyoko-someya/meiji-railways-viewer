# 国土数値情報（鉄道時系列 N05-23）から、1912年までに開業した路線と駅だけを取り出して、
# 小さなファイル data/rail-1872-1913.json を作るスクリプト。
# 使い方：プロジェクトのフォルダで  python3 data/make_rail_data.py
# 元データ（data/Rail-ts/）は読むだけで、書き換えない。

import json
import os

# このファイルがある data/ フォルダを基準にする
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(DATA_DIR, "Rail-ts", "utf8")  # 文字化けしない UTF-8 版を使う
OUT_PATH = os.path.join(DATA_DIR, "rail-1872-1913.json")

LAST_YEAR = 1912  # この年までに開業したものを残す
UNKNOWN_YEAR = 999  # 元データでは、開業年が 999 のものは「不明」を表す

# ファイルを軽くするための設定
DECIMALS = 4  # 座標を小数点以下4桁（約10m刻み）に丸める
TOLERANCE = 0.0001  # 線を単純にするときの許容のずれ（度。約10m）


def read_features(filename):
    """GeoJSON を読んで、地物（路線や駅）のリストを返す"""
    with open(os.path.join(SRC_DIR, filename), encoding="utf-8") as f:
        return json.load(f)["features"]


def to_year(value):
    """開業年の文字列を整数にする。読めないときや「不明（999）」のときは None"""
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return None if year == UNKNOWN_YEAR else year


def simplify(points, tolerance):
    """ダグラス・ポイカー法：線の形がほぼ変わらない範囲で、途中の点を間引く"""
    n = len(points)
    if n < 3:
        return points
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]  # まだ調べていない区間（始点の番号, 終点の番号）
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        farthest, farthest_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if length2 == 0:
                dist = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                # 点 p から、始点と終点を結ぶ線分までの距離
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
                dist = ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5
            if dist > farthest:
                farthest, farthest_i = dist, i
        if farthest > tolerance:
            # 一番遠い点は残して、その前後をさらに調べる
            keep[farthest_i] = True
            stack.append((a, farthest_i))
            stack.append((farthest_i, b))
    return [p for p, k in zip(points, keep) if k]


def lighten(coords):
    """座標を丸めて、同じ点の連続を取り除き、点を間引く"""
    rounded = [[round(x, DECIMALS), round(y, DECIMALS)] for x, y in coords]
    result = [rounded[0]]
    for point in rounded[1:]:
        if point != result[-1]:
            result.append(point)
    return simplify(result, TOLERANCE)


def period_key(start, end):
    """駅名の新旧を比べるための値。設置期間（その名前だった期間）の開始・終了の年から作る。
    元データでは、開始が 999 のものは「1949年以前で不明」なので、一番古いものとして 0 にする"""
    start = int(start)
    return (0 if start == UNKNOWN_YEAR else start, int(end))


def station_display_name(name_periods):
    """駅名の表示。一番古い名前を主にして、新しい名前を古い順に（）で併記する。
    name_periods は {駅名: 設置期間から作った値} の辞書"""
    names = sorted(name_periods, key=lambda n: name_periods[n])  # 古い順
    main = names[0]
    newer = names[1:]
    return main + "（" + "・".join(newer) + "）" if newer else main


def main():
    lines = []
    for feature in read_features("N05-23_RailroadSection2.geojson"):
        p = feature["properties"]
        year = to_year(p["N05_004"])
        if year is None or year > LAST_YEAR:
            continue
        geometry = feature["geometry"]
        # 1本の線も、複数の線のまとまり（MultiLineString）も、線のリストにそろえる
        if geometry["type"] == "LineString":
            parts = [geometry["coordinates"]]
        else:
            parts = geometry["coordinates"]
        lines.append(
            {
                "name": p["N05_002"],  # 路線名
                "company": p["N05_003"],  # 運営会社
                "type": p["N05_001"],  # 事業者の種別（コード）
                "year": year,  # 開業年
                "coords": [lighten(part) for part in parts],
            }
        )

    # 元データでは、複数の路線が通る駅（例：桜木町）が路線ごとに別々の地物になっている。
    # また、同じ位置に別の表記の駅名（例：西宮／西ノ宮）がある場合もある。
    # 位置が同じものは「同じ駅」として1つにまとめる（開業年は一番早いもの）。
    stations_by_pos = {}
    for feature in read_features("N05-23_Station2.geojson"):
        p = feature["properties"]
        year = to_year(p["N05_004"])
        if year is None or year > LAST_YEAR:
            continue
        x, y = feature["geometry"]["coordinates"]
        key = (round(x, 5), round(y, 5))  # 位置が同じかどうかは、小数5桁で比べる
        station = stations_by_pos.get(key)
        if station is None:
            station = {"names": {}, "lines": [], "year": year, "lon": key[0], "lat": key[1]}
            stations_by_pos[key] = station
        elif year < station["year"]:
            station["year"] = year
        # 駅名ごとに、その名前だった期間（設置期間）を覚えておく。新旧の判定に使う
        period = period_key(p["N05_005b"], p["N05_005e"])
        name = p["N05_011"]
        if name not in station["names"] or period < station["names"][name]:
            station["names"][name] = period
        # この駅に、路線ごとの開業年を記録する（同じ路線が重複していたら早い年を残す）
        for item in station["lines"]:
            if item["name"] == p["N05_002"] and item["company"] == p["N05_003"]:
                item["year"] = min(item["year"], year)
                break
        else:
            station["lines"].append(
                {
                    "name": p["N05_002"],  # 路線名
                    "company": p["N05_003"],  # 運営会社
                    "type": p["N05_001"],  # 事業者の種別（コード）
                    "year": year,  # この路線の駅としての開業年
                }
            )

    stations = []
    for station in stations_by_pos.values():
        station["lines"].sort(key=lambda item: item["year"])  # 古い順に並べる
        stations.append(
            {
                "name": station_display_name(station["names"]),
                "lines": station["lines"],
                "year": station["year"],
                "lon": round(station["lon"], DECIMALS),
                "lat": round(station["lat"], DECIMALS),
            }
        )

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"lines": lines, "stations": stations}, f, ensure_ascii=False, separators=(",", ":"))

    print("路線:", len(lines), "本 / 駅:", len(stations), "件")
    print("開業年の最小（路線）:", min(l["year"] for l in lines))
    print("開業年の最小（駅）:", min(s["year"] for s in stations))
    print("路線の点の数:", sum(len(part) for l in lines for part in l["coords"]))
    print("出力:", OUT_PATH, "(", os.path.getsize(OUT_PATH) // 1024, "KB )")


main()
