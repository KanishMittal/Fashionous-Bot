from flask import Flask, render_template, request, jsonify, session
import json
import os
import csv
from typing import Dict, List, Any

app = Flask(__name__)
app.secret_key = "fashionous_secret_key"

# Load blouse data
DATA_PATH = os.path.join(os.path.dirname(__file__), "Fashionous Blouse Data.json")
with open(DATA_PATH, "r", encoding="utf-8") as f:
    blouse_data = json.load(f)

# Precompute valid options for strict matching
fabrics = set()
sleeves = set()
necklines = set()
occasions = set()

for item in blouse_data:
    fabric = item.get("fabric", [])
    if isinstance(fabric, list):
        fabrics.update([str(f).lower().strip() for f in fabric])
    else:
        fabrics.add(str(fabric).lower().strip())
    sleeve = str(item.get("sleeve", "")).lower().strip()
    if sleeve:
        sleeves.add(sleeve)
    neckline = str(item.get("neckline", "")).lower().strip()
    if neckline:
        necklines.add(neckline)
    occasion_tags = item.get("occasion_tags", [])
    occasions.update([str(tag).lower().strip() for tag in occasion_tags])

QUESTION_FLOW = [
    {"key": "fabric", "q": "What fabric do you prefer? (e.g., silk, cotton, georgette)"},
    {"key": "occasion", "q": "Is this for a specific occasion? (e.g., wedding, party, office)"},
    {"key": "neckline", "q": "Any preferred neckline style? (e.g., v-neck, boat neck, sweetheart)"},
    {"key": "sleeve", "q": "What sleeve style do you like? (e.g., sleeveless, full sleeve, cap sleeve)"},
]

def strict_match_score(item: Dict[str, Any], criteria: Dict[str, str]) -> int:
    matches = 0
    for key, value in criteria.items():
        if not value:
            continue
        item_value = item.get(key, "")
        if isinstance(item_value, list):
            if any(value == str(v).lower() for v in item_value):
                matches += 1
        else:
            if value == str(item_value).lower():
                matches += 1
    return matches

def hybrid_smart_search(criteria: Dict[str, str], data: List[Dict[str, Any]], top_k=5) -> List[Dict[str, Any]]:
    strict_results = [
        item for item in data
        if strict_match_score(item, criteria) == sum(1 for v in criteria.values() if v)
    ]
    if strict_results:
        return strict_results[:top_k]
    scored = []
    for item in data:
        matches = strict_match_score(item, criteria)
        if matches > 0:
            scored.append((matches, item))
    scored.sort(reverse=True, key=lambda x: x[0])
    return [item for matches, item in scored[:top_k]]

# --- Questionnaire-specific matching algorithm ---
def questionnaire_matching_algorithm(criteria, data, top_k=5):
    """Prioritizes exact matches, then closest matches with scoring"""
    # Phase 1: Exact matches for all answered criteria
    exact_matches = []
    for item in data:
        match = True
        for key, value in criteria.items():
            if not value:
                continue
            item_value = item.get(key)
            if isinstance(item_value, list):
                if value not in [str(v).lower().strip() for v in item_value]:
                    match = False
                    break
            else:
                if str(item_value).lower().strip() != value:
                    match = False
                    break
        if match:
            exact_matches.append(item)
    if exact_matches:
        return sorted(exact_matches, key=lambda x: x.get('price_inr', 0))[:top_k]

    # Phase 2: Weighted partial matches
    scored_items = []
    for item in data:
        score = 0
        for key, value in criteria.items():
            if not value:
                continue
            item_value = item.get(key)
            if isinstance(item_value, list):
                item_values = [str(v).lower().strip() for v in item_value]
                if value in item_values:
                    score += 3
            else:
                item_value = str(item_value).lower().strip()
                if item_value == value:
                    score += 3
                elif value in item_value:
                    score += 1
        if score > 0:
            scored_items.append((score, item))
    scored_items.sort(key=lambda x: (-x[0], x[1].get('price_inr', 0)))
    return [item for score, item in scored_items[:top_k]]

def parse_chat_to_criteria(message: str) -> Dict[str, str]:
    criteria = {}
    tokens = message.lower().split()
    for token in tokens:
        if token in fabrics:
            criteria["fabric"] = token
        elif token in sleeves:
            criteria["sleeve"] = token
        elif token in necklines:
            criteria["neckline"] = token
        elif token in occasions:
            criteria["occasion"] = token
    return criteria

@app.route("/")
def index():
    session.clear()
    return render_template("index.html")

@app.route("/questionnaire")
def questionnaire_page():
    return render_template("questionnaire.html")

@app.route("/chat")
def chat_page():
    return render_template("chat.html")

@app.route("/api/questionnaire_options")
def questionnaire_options():
    return jsonify({
        "fabric": sorted(list(fabrics)),
        "occasion": sorted(list(occasions)),
        "neckline": sorted(list(necklines)),
        "sleeve": sorted(list(sleeves)),
    })

@app.route("/api/start", methods=["POST"])
def start_conversation():
    mode = request.json.get("mode")
    session.clear()
    session["mode"] = mode
    session["criteria"] = {}
    session["step"] = 0
    if mode == "questionnaire":
        question = QUESTION_FLOW[0]["q"]
        return jsonify({"question": question})
    else:
        return jsonify({"message": "You can start chatting or use voice input. Describe your ideal blouse!"})

@app.route("/api/questionnaire", methods=["POST"])
def questionnaire():
    # Now expects { "criteria": { ... } } from frontend
    data = request.json
    criteria = data.get("criteria", {})
    # Defensive: ensure all values are lowercase/stripped
    for k, v in criteria.items():
        if isinstance(v, str):
            criteria[k] = v.lower().strip()
    results = questionnaire_matching_algorithm(criteria, blouse_data)
    if not results:
        results = sorted(blouse_data, key=lambda x: x.get('price_inr', 0))[:5]
    return jsonify({"results": results})

@app.route("/api/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message", "").strip().lower()
    criteria = parse_chat_to_criteria(user_message)
    results = hybrid_smart_search(criteria, blouse_data)
    if results:
        return jsonify({"results": results})
    else:
        return jsonify({"results": [], "message": "No close matches found."})

@app.route("/api/place_order", methods=["POST"])
def place_order():
    data = request.json
    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    address = data.get("address", "").strip()
    products = data.get("products", [])

    if not name or not phone or not address or not products:
        return jsonify({"success": False, "message": "Please provide all required details and at least one product."})

    csv_file = os.path.join(os.path.dirname(__file__), "orders.csv")
    file_exists = os.path.isfile(csv_file)

    total_amount = 0
    for prod in products:
        try:
            total_amount += int(prod.get("price_inr", 0))
        except (ValueError, TypeError):
            total_amount += 0

    with open(csv_file, mode='a', newline='', encoding='utf-8') as f:
        fieldnames = ["name", "phone", "address", "blouse_title", "blouse_id", "price_inr", "total_amount"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        for prod in products:
            row = {
                "name": name,
                "phone": phone,
                "address": address,
                "blouse_title": prod.get("title", ""),
                "blouse_id": prod.get("design_id", ""),
                "price_inr": prod.get("price_inr", 0),
                "total_amount": total_amount
            }
            writer.writerow(row)

    return jsonify({
        "success": True,
        "message": f"Order placed for {len(products)} product(s)! Total: â‚¹{total_amount}",
        "total_amount": total_amount
    })

if __name__ == "__main__":
    app.run(debug=True)
else:
    # For Vercel deployment
    app = app