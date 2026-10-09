"""Manage the recycler directory.

    python scripts/partners.py seed-demo          # adds clearly-labelled DEMO partners
    python scripts/partners.py list               # all partners with status
    python scripts/partners.py approve <id>       # list a partner who applied

Uses the same env vars as the API (TABLE_NAME, AWS region/credentials). Demo partners
are fictional and always shown with a "Demo partner" label in the app.
"""

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "api"))

from app import db  # noqa: E402

DEMO = [
    {"name": "Demo Kabadi Collective", "area": "Kothrud", "city": "Pune", "materials": ["newspaper", "cardboard", "pet", "ferrous", "aluminium"], "phone": "+91 00000 00001"},
    {"name": "Demo E-waste Point", "area": "Baner", "city": "Pune", "materials": ["ewaste", "copper", "brass"], "phone": "+91 00000 00002"},
]


def put(p: dict, status: str, demo: bool) -> str:
    pid = uuid.uuid4().hex[:10]
    db.table().put_item(Item={"PK": f"PARTNER#{pid}", "SK": "META", "GSI1PK": "PARTNERS", "GSI1SK": f"{status}#{pid}", "id": pid, **p, "status": status, "is_demo": demo, "created_at": db.now_iso()})
    return pid


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "seed-demo":
        for p in DEMO:
            print("added demo", put(p, "approved", True), p["name"])
    elif cmd == "approve":
        pid = sys.argv[2]
        db.table().update_item(Key={"PK": f"PARTNER#{pid}", "SK": "META"}, UpdateExpression="SET #s = :a, GSI1SK = :k", ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":a": "approved", ":k": f"approved#{pid}"})
        print("approved", pid)
    else:
        from boto3.dynamodb.conditions import Key

        for p in db.table().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq("PARTNERS"))["Items"]:
            print(p["id"], p["status"], "DEMO" if p.get("is_demo") else "", p["name"], p["city"])


if __name__ == "__main__":
    main()
