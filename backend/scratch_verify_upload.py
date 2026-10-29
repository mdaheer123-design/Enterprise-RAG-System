import requests
import time
import sys

def main():
    url = "http://localhost:8000/api/documents/upload"
    files = [("files", ("test_upload_verify.txt", b"This is a verification document to confirm indexing works without failing. It has multiple sentences to form proper text content.", "text/plain"))]
    print(f"Uploading file to {url}...")
    res = requests.post(url, files=files)
    print("Upload status code:", res.status_code)
    if res.status_code != 200:
        print("Upload response:", res.text)
        sys.exit(1)

    docs = res.json()
    doc = docs[0]
    doc_id = doc["id"]
    print(f"Uploaded doc ID: {doc_id}, initial status: {doc.get('status')}")

    # Poll for up to 30 seconds
    for i in range(15):
        time.sleep(2)
        poll_res = requests.get(f"http://localhost:8000/api/documents/{doc_id}")
        doc_data = poll_res.json()
        status = doc_data.get("status")
        print(f"Poll {i+1}: status = {status}")
        if status == "indexed":
            print("SUCCESS! Document indexed successfully!")
            chunks_res = requests.get(f"http://localhost:8000/api/documents/{doc_id}/chunks")
            print(f"Chunks count: {len(chunks_res.json()) if chunks_res.status_code == 200 else chunks_res.status_code}")
            del_res = requests.delete(f"http://localhost:8000/api/documents/{doc_id}")
            print("Deleted test doc status code:", del_res.status_code)
            sys.exit(0)
        elif status == "failed":
            print("FAILURE! Document failed indexing!")
            print("Error message:", doc_data.get("error_message"))
            sys.exit(1)

    print("Timeout waiting for indexing!")
    sys.exit(1)

if __name__ == "__main__":
    main()
