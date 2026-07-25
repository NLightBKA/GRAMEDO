# GRAMEDO — Requirements Document

> **Graph-based RAG Memory with Code Structure Intelligence**
> *Version 0.1 — Draft*

---

## 1. Tổng Quan Dự Án

**GRAMEDO** là một hệ thống memory dạng **graph** được thiết kế để phục vụ cho **RAG (Retrieval-Augmented Generation)**. Mục tiêu cốt lõi là phân tích source code của các dự án phần mềm và biểu diễn toàn bộ cấu trúc lớp (class diagram) cùng quan hệ giữa các phương thức (method call graph) thành một đồ thị thống nhất — làm nền tảng tri thức (knowledge graph) cho AI truy vấn ngữ cảnh code một cách chính xác.

---

## 2. Ngôn Ngữ Hỗ Trợ

Hệ thống phải có khả năng phân tích source code của các ngôn ngữ sau:

| Ngôn ngữ       | Extension tiêu biểu           | Parser cần hỗ trợ              |
|----------------|-------------------------------|--------------------------------|
| Java           | `.java`                       | AST (JavaParser / Tree-sitter) |
| JavaScript     | `.js`, `.mjs`, `.cjs`         | AST (Babel / Tree-sitter)      |
| TypeScript     | `.ts`, `.tsx`                 | TypeScript Compiler API        |
| Python         | `.py`                         | AST (ast module / Tree-sitter) |
| C#             | `.cs`                         | Roslyn / Tree-sitter           |
| C++            | `.cpp`, `.cc`, `.h`, `.hpp`   | Clang / Tree-sitter            |

---

## 3. Cấu Trúc Graph

### 3.1 Loại Node (Node Types)

```
NodeType
├── Package / Namespace / Module
├── File
├── Class
├── Interface
├── Abstract Class
├── Enum
├── Struct (C#, C++)
├── Method / Function
├── Field / Attribute / Property
└── Constructor
```

Mỗi Node chứa metadata:
- `id` — định danh duy nhất (đường dẫn đầy đủ + tên)
- `name` — tên ngắn
- `language` — ngôn ngữ nguồn
- `file_path` — đường dẫn file nguồn
- `line_start` / `line_end` — vị trí trong file
- `visibility` — `public`, `private`, `protected`, `internal`, v.v.
- `is_static` — boolean
- `doc_comment` — docstring / Javadoc / XML doc nếu có
- `signature` — chữ ký đầy đủ (đối với method)

---

### 3.2 Loại Edge (Edge Types)

#### 3.2.1 Quan Hệ Cấu Trúc Lớp (Class Diagram Edges)

| Edge Type         | Nguồn → Đích                          | Ý nghĩa                                     |
|-------------------|---------------------------------------|---------------------------------------------|
| `INHERITS`        | `Class → Class/Abstract Class`        | Kế thừa (`extends`)                         |
| `IMPLEMENTS`      | `Class → Interface`                   | Triển khai interface                        |
| `HAS_FIELD`       | `Class → Field`                       | Lớp có thuộc tính                           |
| `HAS_METHOD`      | `Class → Method`                      | Lớp có phương thức                          |
| `HAS_CONSTRUCTOR` | `Class → Constructor`                 | Lớp có constructor                          |
| `RETURNS_TYPE`    | `Method → Class/Interface/Enum`       | Kiểu trả về của method                      |
| `PARAMETER_TYPE`  | `Method → Class/Interface`            | Kiểu tham số đầu vào                        |
| `FIELD_TYPE`      | `Field → Class/Interface/Enum`        | Kiểu dữ liệu của field                      |
| `ASSOCIATION`     | `Class → Class`                       | Quan hệ sử dụng (dùng như field type)       |
| `DEPENDENCY`      | `Class → Class`                       | Quan hệ phụ thuộc (dùng trong method scope) |
| `AGGREGATION`     | `Class → Class`                       | Tổng hợp (chứa collection của lớp khác)     |
| `COMPOSITION`     | `Class → Class`                       | Thành phần (lifecycle gắn liền)             |
| `BELONGS_TO_FILE` | `Class/Interface → File`              | Định vị file chứa định nghĩa               |
| `IN_PACKAGE`      | `File/Class → Package/Namespace`      | Thuộc package/namespace/module              |

#### 3.2.2 Quan Hệ Gọi Phương Thức (Method Call Graph Edges)

| Edge Type    | Nguồn → Đích                       | Metadata                                                              |
|--------------|------------------------------------|-----------------------------------------------------------------------|
| `CALLS`      | `Method → Method`                  | `from: <method_id>`, `called: <method_id>`, `line: <số dòng gọi>`, `is_conditional: bool`, `is_recursive: bool` |
| `OVERRIDES`  | `Method (Child) → Method (Parent)` | Ghi đè phương thức của lớp cha                                       |
| `OVERLOADS`  | `Method → Method`                  | Cùng tên, khác signature (trong cùng lớp)                            |

---

## 4. Tính Năng Chính

### 4.1 Parser & Indexer

- Quét toàn bộ project theo đường dẫn gốc được cấu hình.
- Tự động nhận diện ngôn ngữ qua extension file.
- Phân tích AST để trích xuất:
  - Tất cả class, interface, enum, struct
  - Quan hệ kế thừa / triển khai
  - Các field và method
  - Các lời gọi phương thức bên trong thân method (`method body call analysis`)
- Hỗ trợ **incremental update**: chỉ re-parse file thay đổi dựa trên file hash hoặc timestamp.

### 4.2 Graph Builder

- Xây dựng đồ thị từ kết quả parse.
- Giải quyết **cross-file / cross-package references** (ví dụ: class A ở file 1 gọi class B ở file 2).
- Merge toàn bộ class diagram của project thành **1 graph thống nhất**.
- Đảm bảo không trùng lặp node (deduplication theo `id` duy nhất).

### 4.3 Method Call Resolution

- Phân tích thân method để phát hiện tất cả lời gọi hàm.
- Liên kết lời gọi với đích thực tế (resolve virtual dispatch, interface call, static call...).
- Gắn metadata cho mỗi edge `CALLS`:
  - Dòng code chứa lời gọi
  - Điều kiện gọi (trong `if`, `try`, v.v.)
  - Đệ quy trực tiếp / gián tiếp

### 4.4 RAG Integration

- Cung cấp API truy vấn graph để phục vụ RAG:
  - **Lấy context lớp**: toàn bộ field, method, kế thừa, quan hệ
  - **Lấy call chain**: các method được gọi từ method X (depth có thể cấu hình)
  - **Tìm callers**: ai gọi method X
  - **Subgraph extraction**: lấy subgraph liên quan đến 1 class hoặc module
- Serialization sang định dạng chuẩn cho LLM: JSON, Markdown summary, hoặc text graph.

### 4.5 Lưu Trữ

- Hỗ trợ backend graph database:
  - **Neo4j** (khuyến nghị cho production)
  - **NetworkX in-memory** (cho development / small project)
  - **SQLite + JSON** (lightweight option)
- Schema migration / versioning khi cấu trúc graph thay đổi.

---

## 5. Luồng Hoạt Động (High-Level Flow)

```
Project Root
     │
     ▼
[File Scanner]
     │  Duyệt file theo ngôn ngữ
     ▼
[Language Parser]  ──── (Java / JS / TS / Python / C# / C++)
     │  AST → Nodes & Edges thô
     ▼
[Graph Builder]
     │  Resolve references → Build unified graph
     ▼
[Method Call Analyzer]
     │  Phân tích body → CALLS edges
     ▼
[Graph Store]  ──── (Neo4j / NetworkX / SQLite)
     │
     ▼
[RAG Query API]
     │
     ▼
   LLM / Agent
```

---

## 6. Ví Dụ Graph

```
[Class: OrderService]
  ├─ INHERITS ──────────────► [Class: BaseService]
  ├─ IMPLEMENTS ────────────► [Interface: IOrderService]
  ├─ HAS_FIELD ─────────────► [Field: orderRepository: OrderRepository]
  ├─ HAS_METHOD ────────────► [Method: createOrder(userId: Long): Order]
  │     └─ CALLS ──────────► [Method: OrderRepository.save(Order)]
  │     └─ CALLS ──────────► [Method: EmailService.sendConfirmation(String)]
  └─ HAS_METHOD ────────────► [Method: cancelOrder(orderId: Long): void]
        └─ CALLS ──────────► [Method: OrderRepository.findById(Long)]
        └─ CALLS ──────────► [Method: cancelOrder(orderId)] ← RECURSIVE
```

---

## 7. Yêu Cầu Phi Chức Năng

| Tiêu chí            | Yêu cầu                                                      |
|---------------------|--------------------------------------------------------------|
| **Hiệu năng**       | Parse project 10k file trong < 5 phút                       |
| **Độ chính xác**    | Recall class relationship >= 95% so với class diagram thực  |
| **Incremental**     | Update graph < 30s với thay đổi <= 10 file                  |
| **Extensibility**   | Dễ thêm ngôn ngữ mới qua plugin/adapter pattern             |
| **Idempotency**     | Chạy lại trên cùng project → graph không thay đổi           |

---

## 8. Ngoài Phạm Vi (Out of Scope — v0.1)

- Phân tích runtime behavior (dynamic dispatch thực tế khi chạy)
- Phân tích binary / bytecode
- Phân tích test coverage
- UI đồ họa trực quan hóa graph (có thể ở v0.2)

---

## 9. Glossary

| Thuật ngữ     | Định nghĩa                                                                                 |
|---------------|--------------------------------------------------------------------------------------------|
| **RAG**       | Retrieval-Augmented Generation — kỹ thuật LLM tìm kiếm context trước khi sinh câu trả lời |
| **AST**       | Abstract Syntax Tree — cây cú pháp trừu tượng của source code                             |
| **Call Graph**| Đồ thị biểu diễn quan hệ gọi hàm giữa các method                                         |
| **Subgraph**  | Một phần đồ thị được trích xuất theo điều kiện                                             |
| **Node**      | Đỉnh trong graph, đại diện cho một thực thể code                                           |
| **Edge**      | Cạnh trong graph, đại diện cho một quan hệ giữa hai thực thể                              |
