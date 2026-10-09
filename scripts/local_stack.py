"""Local stack for trying the API without AWS: a moto server stands in for DynamoDB/S3.

    services/api/.venv/Scripts/moto_server -p 5555                       # terminal 1
    services/api/.venv/Scripts/python scripts/local_stack.py setup        # creates table + bucket
    services/api/.venv/Scripts/python scripts/local_stack.py device <sub>  # prints a device key
    (then run uvicorn with the env vars printed by `setup`)

Cognito isn't emulated, so routes that need a signed-in user can't be called this way;
the IoT ingest route (device key) and /health can.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = {
    "AWS_ENDPOINT_URL": "http://localhost:5555",
    "AWS_ACCESS_KEY_ID": "local",
    "AWS_SECRET_ACCESS_KEY": "local",
    "AWS_DEFAULT_REGION": "ap-south-1",
    "STAGE": "local",
    "TABLE_NAME": "groundwork-local",
    "UPLOADS_BUCKET": "groundwork-uploads-local",
}
os.environ.update(ENV)
sys.path.insert(0, str(ROOT / "services" / "api"))

import boto3  # noqa: E402


def setup() -> None:
    ddb = boto3.client("dynamodb")
    names = ddb.list_tables()["TableNames"]
    if ENV["TABLE_NAME"] not in names:
        ddb.create_table(
            TableName=ENV["TABLE_NAME"],
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("PK", "SK", "GSI1PK", "GSI1SK")],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "GSI1",
                    "KeySchema": [{"AttributeName": "GSI1PK", "KeyType": "HASH"}, {"AttributeName": "GSI1SK", "KeyType": "RANGE"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
    s3 = boto3.client("s3")
    if ENV["UPLOADS_BUCKET"] not in [b["Name"] for b in s3.list_buckets().get("Buckets", [])]:
        s3.create_bucket(Bucket=ENV["UPLOADS_BUCKET"], CreateBucketConfiguration={"LocationConstraint": "ap-south-1"})
    print("ready. Run the API with:")
    print(" ".join(f"{k}={v}" for k, v in ENV.items()), "services/api/.venv/Scripts/python -m uvicorn app.main:app --port 8080")


def device(sub: str) -> None:
    from app.services import water

    print(water.create_device(sub, "Simulated meter")["key"])


def summary(sub: str) -> None:
    import json

    from app.services import water

    print(json.dumps(water.summary(sub), indent=2, default=str))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    {"setup": lambda: setup(), "device": lambda: device(sys.argv[2]), "summary": lambda: summary(sys.argv[2])}[cmd]()
