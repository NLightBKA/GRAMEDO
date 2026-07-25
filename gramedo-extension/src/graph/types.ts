// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Graph Types
// Defines all node types, edge types, and data structures for the RAG graph.
// ─────────────────────────────────────────────────────────────────────────────

export enum NodeType {
    Package     = 'Package',
    File        = 'File',
    Class       = 'Class',
    Interface   = 'Interface',
    AbstractClass = 'AbstractClass',
    Enum        = 'Enum',
    Struct      = 'Struct',
    Method      = 'Method',
    Function    = 'Function',
    Field       = 'Field',
    Property    = 'Property',
    Constructor = 'Constructor',
}

export enum EdgeType {
    // Class diagram edges
    INHERITS        = 'INHERITS',
    IMPLEMENTS      = 'IMPLEMENTS',
    HAS_FIELD       = 'HAS_FIELD',
    HAS_METHOD      = 'HAS_METHOD',
    HAS_CONSTRUCTOR = 'HAS_CONSTRUCTOR',
    RETURNS_TYPE    = 'RETURNS_TYPE',
    PARAMETER_TYPE  = 'PARAMETER_TYPE',
    FIELD_TYPE      = 'FIELD_TYPE',
    ASSOCIATION     = 'ASSOCIATION',
    DEPENDENCY      = 'DEPENDENCY',
    AGGREGATION     = 'AGGREGATION',
    COMPOSITION     = 'COMPOSITION',
    BELONGS_TO_FILE = 'BELONGS_TO_FILE',
    IN_PACKAGE      = 'IN_PACKAGE',
    // Method call graph edges
    CALLS           = 'CALLS',
    OVERRIDES       = 'OVERRIDES',
    OVERLOADS       = 'OVERLOADS',
}

export interface GraphNode {
    /** Unique identifier: absolute_file_path::ContainerName::MemberName */
    id: string;
    /** Short name (e.g. "OrderService") */
    name: string;
    type: NodeType;
    language: string;
    /** Relative path from project root */
    file_path: string;
    line_start: number;
    line_end: number;
    /** "public" | "private" | "protected" | "internal" | "package" */
    visibility: string;
    is_static: boolean;
    doc_comment: string | null;
    /** Full signature for methods (e.g. "createOrder(userId: Long): Order") */
    signature: string | null;
    /** ID of the containing class/interface node, if any */
    parent_id?: string;
}

export interface EdgeMetadata {
    line?: number;
    is_conditional?: boolean;
    is_recursive?: boolean;
    /** When the target could not be resolved to a full node id yet */
    unresolved_target?: string;
    [key: string]: unknown;
}

export interface GraphEdge {
    id: string;
    type: EdgeType;
    source: string;
    target: string;
    metadata: EdgeMetadata;
}

export interface GraphStats {
    nodes: number;
    edges: number;
    files: number;
    by_language: Record<string, number>;
}

export interface GraphData {
    version: string;
    generated_at: string;
    project_root: string;
    stats: GraphStats;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface IndexedFile {
    path: string;
    language: string;
    hash: string;
    last_modified: string;
    indexed_at: string;
    node_count: number;
}

export interface FileIndex {
    files: IndexedFile[];
}

export interface ParseResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    filePath: string;
    language: string;
}

export interface ScannedFile {
    absolutePath: string;
    relativePath: string;
    language: string;
    extension: string;
    sizeBytes: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export type ProgressEvent =
    | { phase: 'scan';   total: number }
    | { phase: 'parse';  current: number; total: number; file: string }
    | { phase: 'build' }
    | { phase: 'write' }
    | { phase: 'done';   stats: GraphStats }
    | { phase: 'error';  message: string };
