# NetSuite CSV export client: trigger, poll status, download the file
# Usage:
#   python 4_python_client.py --search-id customsearch_component_kit_item
#   python 4_python_client.py --job-id 
#   python 4_python_client.py --file-id 211737 --file-name export.csv

import argparse
import requests
from requests_oauthlib import OAuth1
import time
import os

from dotenv import load_dotenv
load_dotenv()

ACCOUNT_ID = os.environ.get("NS_ACCOUNT_ID", "6403579_SB1")

CONSUMER_KEY = os.environ["NS_CONSUMER_KEY"]
CONSUMER_SECRET = os.environ["NS_CONSUMER_SECRET"]
TOKEN_ID = os.environ["NS_TOKEN_ID"]
TOKEN_SECRET = os.environ["NS_TOKEN_SECRET"]

DEFAULT_SEARCH_ID = os.environ["NS_SEARCH_ID"]
DEFAULT_FOLDER_ID = int(os.environ["NS_FOLDER_ID"])

DEFAULT_SCRIPT_ID = os.environ["NS_SCRIPT_ID"]
DEFAULT_SCRIPTDEPLOY_ID = os.environ["NS_SCRIPTDEPLOY_ID"]

BASE_RESTLET_DOMAIN =os.environ["BASE_RESTLET_DOMAIN"]
BASE_APP_DOMAIN = os.environ["BASE_APP_DOMAIN"]

# SE | Restlet | Export Data        
# SE | Restlet | Export Status Check 
# SE | Restlet | Download File     
#   
TRIGGER_RESTLET_URL = f"{BASE_RESTLET_DOMAIN}{os.environ["TRIGGER_RESTLET_URL"]}"
STATUS_RESTLET_URL = f"{BASE_RESTLET_DOMAIN}{os.environ["STATUS_RESTLET_URL"]}"
DOWNLOAD_RESTLET_URL = f"{BASE_RESTLET_DOMAIN}{os.environ["DOWNLOAD_RESTLET_URL"]}"

DOWNLOAD_LINE_COUNT = int(os.environ["DOWNLOAD_LINE_COUNT"])   # lines per chunk

POLL_INTERVAL_SECONDS = int(os.environ["POLL_INTERVAL_SECONDS"])
MAX_WAIT_SECONDS = int(os.environ["MAX_WAIT_SECONDS"])

OUTPUT_DIR = os.environ["OUTPUT_DIR"]

auth = OAuth1(
    client_key=CONSUMER_KEY,
    client_secret=CONSUMER_SECRET,
    resource_owner_key=TOKEN_ID,
    resource_owner_secret=TOKEN_SECRET,
    realm=ACCOUNT_ID,
    signature_method="HMAC-SHA256",
    signature_type="auth_header",
)


def trigger_export(search_id, folder_id, force=False):

    params = {"searchId": search_id,
              "scriptId": DEFAULT_SCRIPT_ID,
              "deploymentId": DEFAULT_SCRIPTDEPLOY_ID
              }
    # if folder_id:
    #     params["folderId"] = folder_id
    params["folderId"] = DEFAULT_FOLDER_ID
    if force:
        params["force"] = "true"

    print("=" * 60)
    print("TRIGGERING EXPORT")
    print("=" * 60)
    print("Search ID:", search_id)
    print("=" * 60)
    print("Folder ID:", DEFAULT_FOLDER_ID)
    print( "Script ID:", DEFAULT_SCRIPT_ID)
    print( "Deployment Id:", DEFAULT_SCRIPTDEPLOY_ID)

    if force:
        print("(force=true - bypassing any in-progress job check)")

    response = requests.get(TRIGGER_RESTLET_URL, auth=auth, params=params, timeout=60)
    response.raise_for_status()
    data = response.json()

    if not data.get("success"):
        if data.get("error") == "ALREADY_RUNNING":
            raise RuntimeError(
                "An export is already running for this search. Find its jobId in "
                "the Map/Reduce Script Status page, then run:\n"
                "  python 4_python_client.py --job-id <that jobId>"
            )
        raise RuntimeError(f"Trigger failed: {data}")

    if data.get("alreadyInProgress"):
        print("An export for this search is already running (reusing existing job).")
        print("Job ID:", data["jobId"])
        print("Current status:", data.get("status"))
        print()
        return data["jobId"]

    print("Job ID:", data["jobId"])
    print("Task ID:", data["taskId"])
    print()

    return data["jobId"]


def poll_status(job_id):

    print("=" * 60)
    print("POLLING STATUS")
    print("=" * 60)

    start = time.time()

    while True:

        elapsed = time.time() - start

        if elapsed > MAX_WAIT_SECONDS:
            raise TimeoutError(f"Export did not complete within {MAX_WAIT_SECONDS} seconds")

        response = requests.get(
            STATUS_RESTLET_URL, auth=auth, params={"jobId": job_id}, timeout=60
        )
        response.raise_for_status()
        data = response.json()

        status = data.get("status", "UNKNOWN")

        print(f"[{elapsed:6.0f}s] status = {status}")

        if status == "COMPLETE":
            print()
            print("Total Rows:", data.get("totalRows"))
            print("File ID:", data.get("fileId"))
            print("File Name:", data.get("fileName"))
            print()
            return data

        if status == "FAILED":
            raise RuntimeError(f"Export failed: {data.get('message')}")

        if status == "NOT_FOUND":
            raise RuntimeError(f"Unknown jobId (may have expired): {job_id}")

        time.sleep(POLL_INTERVAL_SECONDS)


def download_file(file_id, file_name):

    print("=" * 60)
    print("DOWNLOADING FILE")
    print("=" * 60)

    # Uses our own RESTlet (not media.nl) - avoids auth issues and size limits
    output_path = os.path.join(OUTPUT_DIR, file_name)

    start_line = 0
    total_lines_downloaded = 0

    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:

        while True:

            response = requests.get(
                DOWNLOAD_RESTLET_URL,
                auth=auth,
                params={"fileId": file_id, "startLine": start_line, "lineCount": DOWNLOAD_LINE_COUNT},
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()

            if not data.get("success"):
                raise RuntimeError(f"Download chunk failed: {data}")

            for line in data["lines"]:
                f.write(line + "\n")

            total_lines_downloaded += data["lineCount"]

            print(f"  {total_lines_downloaded} lines downloaded (startLine={start_line})")

            if not data.get("hasMore"):
                break

            start_line = data["nextStartLine"]

    print("Saved to:", os.path.abspath(output_path))
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Size: {size_mb:.2f} MB")
    print(f"Total lines (incl. header): {total_lines_downloaded}")
    print()

    return output_path


def parse_args():

    parser = argparse.ArgumentParser(description="NetSuite saved search -> CSV export client.")

    mode = parser.add_mutually_exclusive_group(required=False)

    mode.add_argument("--search-id", default=None,
        help="Trigger a new export for this saved search id. Defaults to NS_SEARCH_ID from .env.")
    mode.add_argument("--job-id",
        help="Skip triggering - poll this jobId, then download.")
    mode.add_argument("--file-id",
        help="Skip trigger + poll - download this fileId directly (needs --file-name).")

    parser.add_argument("--folder-id", default=None,
        help="Only used with --search-id. Defaults to the RESTlet's own default folder.")
    parser.add_argument("--force", action="store_true",
        help="Bypass the in-progress-job check and start a fresh export.")
    parser.add_argument("--file-name", default=None,
        help="Required with --file-id.")

    args = parser.parse_args()

    if args.file_id and not args.file_name:
        parser.error("--file-id requires --file-name")

    if not args.search_id and not args.job_id and not args.file_id:
        if DEFAULT_SEARCH_ID:
            args.search_id = DEFAULT_SEARCH_ID
            print(f"No --search-id given - using NS_SEARCH_ID from .env: {DEFAULT_SEARCH_ID}")
        else:
            parser.error("One of --search-id, --job-id, --file-id is required (or set NS_SEARCH_ID in .env).")

    return args


if __name__ == "__main__":

    args = parse_args()

    if args.file_id:
        download_file(args.file_id, args.file_name)

    else:
        if args.search_id:
            job_id = trigger_export(args.search_id, args.folder_id, args.force)
        else:
            job_id = args.job_id

        result = poll_status(job_id)
        download_file(result["fileId"], result["fileName"])

    print("=" * 60)
    print("EXPORT COMPLETE")
    print("=" * 60)