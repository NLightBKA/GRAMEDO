# 🧠 GRAMEDO

> **Graph-based RAG Memory with Code Structure Intelligence**

GRAMEDO là một **VS Code Extension** phân tích toàn bộ source code của dự án và biểu diễn cấu trúc dưới dạng **knowledge graph (đồ thị tri thức)** — lưu ra file JSON trong thư mục `.memory/` — làm nền tảng cho AI/LLM truy vấn ngữ cảnh code một cách chính xác thông qua **RAG (Retrieval-Augmented Generation)**.

---

## ✨ Tính Năng

- 🔍 **Quét toàn bộ dự án** và nhận diện source file tự động
- 🌳 **Full AST parsing** cho 6 ngôn ngữ lập trình phổ biến
- 🕸️ **Xây dựng knowledge graph** với đầy đủ nodes và edges
- 💾 **Lưu ra JSON** chuẩn vào thư mục `.memory/` trong project root
- 🔄 **Nút Update** — quét lại và reload toàn bộ bộ nhớ chỉ 1 click
- 🎯 **Auto-detect workspace root** — tự lấy folder đang mở trong VS Code
- 🎨 **Dark-themed UI** tích hợp sẵn trong VS Code sidebar

---

## 🌐 Ngôn Ngữ Hỗ Trợ

| Ngôn ngữ | Extension | Parser |
|----------|-----------|--------|
| Java | `.java` | tree-sitter-java (WASM) |
| Python | `.py` | tree-sitter-python (WASM) |
| JavaScript | `.js`, `.mjs`, `.jsx` | TypeScript Compiler API |
| TypeScript | `.ts`, `.tsx` | TypeScript Compiler API |
| C# | `.cs` | tree-sitter-c_sharp (WASM) |
| C / C++ | `.cpp`, `.cc`, `.h`, `.hpp` | tree-sitter-cpp (WASM) |

---

## 📐 Cấu Trúc Graph

### Node Types

```
NodeType
├── Class / AbstractClass
├── Interface
├── Enum / Struct
├── Method / Function
├── Constructor
└── Field / Property
```

Mỗi node có metadata: `id`, `name`, `type`, `language`, `file_path`, `line_start`, `line_end`, `visibility`, `is_static`, `doc_comment`, `signature`

### Edge Types

| Edge | Ý nghĩa |
|------|---------|
| `INHERITS` | Kế thừa (`extends`) |
| `IMPLEMENTS` | Triển khai interface |
| `HAS_METHOD` | Lớp chứa method |
| `HAS_FIELD` | Lớp chứa field |
| `HAS_CONSTRUCTOR` | Lớp chứa constructor |
| `CALLS` | Method A gọi Method B |
| `OVERRIDES` | Method ghi đè method cha |

---

## 📁 Output — Thư Mục `.memory/`

Sau khi index, GRAMEDO tạo ra trong project root:

```
your-project/
└── .memory/
    ├── graph.json    ← Toàn bộ graph (nodes + edges)
    ├── index.json    ← Danh sách file đã scan + hash
    └── meta.json     ← Stats tóm tắt (nodes, edges, files)
```

### Cấu trúc `graph.json`

```json
{
  "version": "0.1",
  "generated_at": "2026-07-25T14:00:00Z",
  "project_root": "/path/to/project",
  "stats": {
    "nodes": 142,
    "edges": 89,
    "files": 23,
    "by_language": { "java": 80, "python": 40, "typescript": 22 }
  },
  "nodes": [
    {
      "id": "src/OrderService.java::OrderService",
      "name": "OrderService",
      "type": "Class",
      "language": "java",
      "file_path": "src/OrderService.java",
      "line_start": 10,
      "line_end": 120,
      "visibility": "public",
      "is_static": false,
      "doc_comment": "/** Handles all order operations */",
      "signature": null
    }
  ],
  "edges": [
    {
      "id": "edge_000001",
      "type": "INHERITS",
      "source": "src/OrderService.java::OrderService",
      "target": "src/BaseService.java::BaseService",
      "metadata": {}
    },
    {
      "id": "edge_000002",
      "type": "CALLS",
      "source": "src/OrderService.java::OrderService::createOrder",
      "target": "OrderRepository.save",
      "metadata": { "line": 45, "is_conditional": false, "is_recursive": false }
    }
  ]
}
```

---

## 🚀 Cài Đặt

### Yêu cầu
- **VS Code** `>= 1.85.0`
- **Node.js** `>= 18` (chỉ cần khi build từ source)

### Cách 1 — Cài từ VSIX (Khuyến nghị)

1. Tải file `gramedo-x.x.x.vsix` từ [Releases](https://github.com/NLightBKA/GRAMEDO/releases)
2. Mở VS Code → `Ctrl+Shift+X` (Extensions)
3. Click nút **`···`** góc trên phải → **"Install from VSIX..."**
4. Chọn file `.vsix` vừa tải
5. **Reload Window** khi được hỏi

### Cách 2 — Build từ Source

```bash
git clone https://github.com/NLightBKA/GRAMEDO.git
cd GRAMEDO/gramedo-extension
npm install
npm run build        # copy WASM grammars + compile
```

Sau đó cài VSIX:
```bash
vsce package --skip-license --no-dependencies
# → tạo ra gramedo-0.1.0.vsix
```
Cài vào VS Code theo Cách 1.

---

## 📖 Hướng Dẫn Sử Dụng

### Bước 1 — Mở dự án cần index

```
File → Open Folder → chọn project (Java, Python, TypeScript, v.v.)
```

### Bước 2 — Mở GRAMEDO Panel

Click biểu tượng **GRAMEDO** trên **Activity Bar** (cột icon bên trái VS Code).

Hoặc: `Ctrl+Shift+P` → gõ `GRAMEDO: Open Panel`

### Bước 3 — Index dự án

- Panel hiển thị **project root** đã được tự động phát hiện
- Nhấn nút **🔄 Update Index**
- Thanh progress hiện ra, hiển thị tiến độ từng file
- Khi xong: stats hiện số **nodes**, **edges**, **files** theo từng ngôn ngữ

### Bước 4 — Xem kết quả

- Click **📂 Open .memory** → mở thư mục output trong Explorer
- Click **📋 Copy path** → copy đường dẫn đến `graph.json`

### Đổi Project Root

Nếu muốn index một folder khác (không phải workspace root):
- Click **📁** bên cạnh đường dẫn → chọn folder mới
- Hoặc set trong Settings: `gramedo.projectRoot`

### Xóa bộ nhớ

Click **🗑️ Clear** → xóa toàn bộ `.memory/`

---

## ⚙️ Cấu Hình

| Setting | Mặc định | Mô tả |
|---------|----------|-------|
| `gramedo.projectRoot` | `""` | Override project root. Để trống = dùng workspace folder đang mở |

---

## 🏗️ Kiến Trúc

```
Project Root
     │
     ▼
[FileScanner]        — Đệ quy quét file, lọc theo extension
     │
     ▼
[Language Parser]    — Java/Python/C#/C++ (tree-sitter WASM)
                     — JS/TS (TypeScript Compiler API)
     │  AST → Nodes & Edges
     ▼
[GraphBuilder]       — Merge + dedup + cross-file resolution
     │
     ▼
[GraphStore]         — Ghi .memory/graph.json + index.json + meta.json
```

---

## 📊 Ví Dụ Graph

```
[Class: OrderService]
  ├─ INHERITS ──────────────► [Class: BaseService]
  ├─ IMPLEMENTS ────────────► [Interface: IOrderService]
  ├─ HAS_FIELD ─────────────► [Field: orderRepository: OrderRepository]
  ├─ HAS_METHOD ────────────► [Method: createOrder(userId): Order]
  │     └─ CALLS ──────────► [Method: OrderRepository.save]
  │     └─ CALLS ──────────► [Method: EmailService.sendConfirmation]
  └─ HAS_METHOD ────────────► [Method: cancelOrder(orderId): void]
        └─ CALLS ──────────► [Method: OrderRepository.findById]
```

---

## 🗺️ Roadmap

- **v0.1** ✅ Full AST parser, graph output, VS Code panel
- **v0.2** — Incremental update (chỉ re-parse file thay đổi)
- **v0.3** — RAG Query API (lấy context class, call chain, callers)
- **v0.4** — Neo4j backend support
- **v0.5** — Graph visualization UI

---

## 📄 License

MIT © 2026 GRAMEDO Project
