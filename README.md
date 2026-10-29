# 🧠 Enterprise AI Knowledge Assistant

> A production-ready RAG-powered document assistant built with React, FastAPI, and Google Gemini.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   React UI  │────▶│  FastAPI API  │────▶│  Google Gemini │
│  (Vite+TS)  │◀────│  (Python)    │◀────│    LLM API     │
└─────────────┘     └──────┬───────┘     └────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │PostgreSQL│ │ ChromaDB │ │BGE Models│
        │  (Meta)  │ │ (Vectors)│ │(Embed/RR)│
        └──────────┘ └──────────┘ └──────────┘
```

### RAG Pipeline

```
Document Upload → Text Extraction → Cleaning → Metadata Extraction
        → Chunking (Recursive) → Embedding (BGE-Large)
        → Vector Storage (ChromaDB)

User Query → Hybrid Search (Dense + BM25) → RRF Fusion
        → Reranking (BGE-Reranker) → Hallucination Check
        → Gemini LLM → Streaming Response → Citation Generation
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Multi-Document Chat** | Upload PDF, DOCX, TXT, CSV, Excel and chat across all documents |
| **Source Citations** | Every answer includes filename, page number, and paragraph references |
| **Hybrid Search** | Dense vector search + BM25 keyword search fused with Reciprocal Rank Fusion |
| **Re-ranking** | BGE-Reranker cross-encoder for precision reranking (top 20 → top 5) |
| **Chat Memory** | Follow-up questions use conversation history stored in PostgreSQL |
| **Document Comparison** | Side-by-side diff of two documents with categorized changes |
| **Streaming Responses** | Server-Sent Events for real-time token-by-token display |
| **Hallucination Detection** | Configurable similarity threshold prevents fabricated answers |
| **Agentic RAG** | Automatic query routing to the best retrieval tool |
| **Analytics Dashboard** | Track uploads, questions, storage, and usage trends |

---

## 📁 Folder Structure

```
RAG/
├── backend/
│   ├── app/
│   │   ├── api/                    # API route handlers
│   │   │   ├── analytics.py
│   │   │   ├── chat.py
│   │   │   ├── collections.py
│   │   │   ├── comparison.py
│   │   │   ├── documents.py
│   │   │   └── search.py
│   │   ├── core/                   # Configuration & infrastructure
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   └── logging.py
│   │   ├── models/                 # SQLAlchemy ORM models
│   │   │   └── models.py
│   │   ├── schemas/                # Pydantic validation schemas
│   │   │   └── schemas.py
│   │   ├── services/               # Business logic layer
│   │   │   ├── chunking.py
│   │   │   ├── document_processor.py
│   │   │   ├── embedding.py
│   │   │   ├── hybrid_search.py
│   │   │   ├── llm.py
│   │   │   ├── rag_pipeline.py
│   │   │   ├── reranker.py
│   │   │   └── vector_store.py
│   │   └── main.py                 # FastAPI application entry
│   ├── tests/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/             # AppLayout, Sidebar, TopBar
│   │   │   └── ui/                 # Button, Card, Badge, etc.
│   │   ├── lib/                    # API client, utilities
│   │   ├── pages/                  # All route pages
│   │   ├── types/                  # TypeScript interfaces
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **PostgreSQL 15+**
- **Google Gemini API key**

### 1. Clone & Configure

```bash
cd RAG

# Backend setup
cp backend/.env.example backend/.env
# Edit backend/.env and add your GOOGLE_API_KEY
```

### 2. Start Database

```bash
# Using Docker
docker compose up postgres chromadb -d

# Or install PostgreSQL locally and create database:
# createdb rag_assistant
```

### 3. Start Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`

---

## 🐳 Docker Deployment

```bash
# Build and run all services
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Services:
- **Frontend**: `http://localhost:3000`
- **Backend**: `http://localhost:8000`
- **API Docs**: `http://localhost:8000/docs`
- **PostgreSQL**: `localhost:5432`
- **ChromaDB**: `localhost:8100`

---

## 🔑 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_API_KEY` | Google Gemini API key | Required |
| `DATABASE_URL` | PostgreSQL async connection | `postgresql+asyncpg://postgres:postgres@localhost:5432/rag_assistant` |
| `GEMINI_MODEL` | Gemini model name | `gemini-1.5-pro` |
| `EMBEDDING_MODEL` | Sentence transformer model | `BAAI/bge-large-en-v1.5` |
| `RERANKER_MODEL` | Cross-encoder reranker | `BAAI/bge-reranker-large` |
| `CHUNK_SIZE` | Text chunk size in characters | `512` |
| `CHUNK_OVERLAP` | Overlap between chunks | `50` |
| `TOP_K_RETRIEVAL` | Initial retrieval count | `20` |
| `TOP_K_RERANK` | Post-rerank count | `5` |
| `SIMILARITY_THRESHOLD` | Hallucination prevention threshold | `0.35` |
| `BM25_WEIGHT` | BM25 search weight | `0.3` |
| `DENSE_WEIGHT` | Dense vector search weight | `0.7` |

---

## 📡 API Documentation

### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload documents (multipart) |
| GET | `/api/documents/` | List documents with filtering |
| GET | `/api/documents/{id}` | Get document details |
| DELETE | `/api/documents/{id}` | Delete document |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/` | Create chat session |
| GET | `/api/chat/` | List chats |
| GET | `/api/chat/{id}` | Get chat with messages |
| POST | `/api/chat/ask` | Ask question (non-streaming) |
| POST | `/api/chat/stream` | Ask question (SSE streaming) |
| DELETE | `/api/chat/{id}` | Delete chat |

### Search
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search/` | Hybrid search |

### Collections
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/collections/` | Create collection |
| GET | `/api/collections/` | List collections |
| PUT | `/api/collections/{id}` | Update collection |
| DELETE | `/api/collections/{id}` | Delete collection |

### Comparison
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/compare/` | Compare two documents |
| GET | `/api/compare/` | List comparisons |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/overview` | Dashboard metrics |

Full interactive docs at: `http://localhost:8000/docs` (after starting the backend)

---

## 🧪 Testing

```bash
cd backend
pytest tests/ -v
```

---

## 🌐 Deployment

### Frontend → Vercel
```bash
cd frontend
npm run build
# Deploy dist/ to Vercel
```

### Backend → Render / Railway
- Set environment variables
- Deploy from Docker or Git
- Ensure PostgreSQL addon is connected

---

## 📄 License

MIT License
