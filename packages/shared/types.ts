/**
 * packages/shared/types.ts
 *
 * Shared TypeScript interfaces for Cyprus Geo-Social TMA.
 * Used by both backend (Fastify) and frontend (React).
 */

// ═══════════════════════════════════════════════════════════════
// Domain Models
// ═══════════════════════════════════════════════════════════════

export interface User {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/** Compact user for embedding in messages / reviews */
export type UserRef = Pick<User, 'id' | 'username' | 'firstName' | 'avatarUrl'>;

export type PlaceCategory =
  | 'park' | 'restaurant' | 'cafe' | 'bar' | 'shop'
  | 'hotel' | 'attraction' | 'beach' | 'museum'
  | 'residential' | 'office' | 'transport' | 'service' | 'other';

export interface PlaceStats {
  reviewsCount: number;
  ratingAvg: number | null;
  ratingDistribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  messagesCount: number;
  photosCount: number;
  lastActivityAt: string | null;
}

export interface Place {
  id: string;
  wikimapiaId: number | null;
  name: string;
  description: string | null;
  photos: string[];
  sourceUrl: string | null;
  category: PlaceCategory | null;
  subcategory: string | null;
  centroid: { lat: number; lon: number };
  stats: PlaceStats;
}

export interface Message {
  id: string;
  placeId: string;
  userId: string;
  user: UserRef;
  body: string;
  replyToId: string | null;
  mentions: number[];
  createdAt: string;
  /** Client-only: local UUID before server ack */
  optimisticId?: string;
  /** Client-only: send lifecycle */
  status?: 'sending' | 'sent' | 'failed';
}

export interface Review {
  id: string;
  placeId: string;
  userId: string;
  user: UserRef;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// REST API — Request / Response
// ═══════════════════════════════════════════════════════════════

// GET /api/places/clusters?bbox=...&zoom=Z&category=...&q=...
export interface ClustersQuery {
  bbox: string;
  zoom: number;
  category?: PlaceCategory;
  q?: string;
}

export interface ClusterFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { cluster: true; pointCount: number; clusterId: number };
}

export interface CentroidFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    category: PlaceCategory | null;
    rating: number | null;
    messagesCount: number;
  };
}

export interface PolygonFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  properties: {
    id: string;
    name: string;
    category: PlaceCategory | null;
    rating: number | null;
    messagesCount: number;
  };
}

export type ClustersResponse =
  | { type: 'FeatureCollection'; mode: 'cluster'; features: ClusterFeature[] }
  | { type: 'FeatureCollection'; mode: 'centroids'; features: CentroidFeature[] }
  | { type: 'FeatureCollection'; mode: 'polygons'; features: PolygonFeature[] };

// GET /api/places/:id
export interface PlaceDetailsResponse extends Place {
  recentMessages: Message[];
  recentPhotos: string[];
  isFavorited: boolean;
}

// GET /api/places/:id/messages?cursor=&limit=
export interface MessagesQuery {
  cursor?: string;
  limit?: number;
}

export interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

// POST /api/places/:id/messages
export interface SendMessageRequest {
  body: string;
  replyToId?: string;
  optimisticId?: string;
}

// GET /api/places/:id/reviews?cursor=&limit=
export interface ReviewsQuery {
  cursor?: string;
  limit?: number;
  sort?: 'recent' | 'highest' | 'lowest';
}

export interface ReviewsResponse {
  reviews: Review[];
  nextCursor: string | null;
  stats: PlaceStats;
}

// POST /api/places/:id/reviews
export interface CreateReviewRequest {
  rating: 1 | 2 | 3 | 4 | 5;
  body?: string;
}

// GET /api/search?q=...&category=...&bbox=...&near=...&limit=
export interface SearchQuery {
  q?: string;
  category?: PlaceCategory;
  bbox?: string;
  near?: string;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  name: string;
  category: PlaceCategory | null;
  rating: number | null;
  centroid: { lat: number; lon: number };
  distanceM?: number;
  highlight?: { name?: string; description?: string };
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number;
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Events (Socket.IO)
// ═══════════════════════════════════════════════════════════════

export interface LivePlacesDiff {
  added: Array<{ placeId: string; onlineCount: number }>;
  changed: Array<{ placeId: string; onlineCount: number }>;
  removed: string[];
  ts: number;
}

export interface ServerToClientEvents {
  new_message: (msg: Message) => void;
  message_ack: (data: { optimisticId: string; message: Message }) => void;
  message_failed: (data: { optimisticId: string; error: string }) => void;
  room_presence: (data: { placeId: string; onlineCount: number }) => void;
  typing: (data: { placeId: string; user: UserRef; isTyping: boolean }) => void;
  live_places_update: (diff: LivePlacesDiff) => void;
  reaction_update: (data: { messageId: string; emoji: string; count: number; userIds: string[] }) => void;
  error: (data: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  join_room: (
    data: { placeId: string },
    ack: (res: { ok: true; onlineCount: number } | { ok: false; error: string }) => void,
  ) => void;
  leave_room: (data: { placeId: string }) => void;
  send_message: (
    data: { placeId: string; body: string; replyToId?: string; optimisticId: string },
    ack: (res: { ok: true; message: Message } | { ok: false; error: string }) => void,
  ) => void;
  typing: (data: { placeId: string; isTyping: boolean }) => void;
  subscribe_live: (data: { bbox: [number, number, number, number] }) => void;
  unsubscribe_live: () => void;
}

// ═══════════════════════════════════════════════════════════════
// Zustand Store Types
// ═══════════════════════════════════════════════════════════════

export interface MapStoreState {
  places: Map<string, Place>;
  selectedPlaceId: string | null;
  livePlaces: Map<string, number>;
  bbox: [number, number, number, number] | null;
  zoom: number;
}

export interface MapStoreActions {
  setBbox: (bbox: [number, number, number, number], zoom: number) => void;
  selectPlace: (id: string | null) => void;
  upsertPlaces: (places: Place[]) => void;
  applyLiveDiff: (diff: LivePlacesDiff) => void;
}

export type MapStore = MapStoreState & MapStoreActions;

export interface ChatStoreState {
  messagesByPlace: Map<string, Message[]>;
  cursors: Map<string, string | null>;
  loading: Set<string>;
  joinedRooms: Set<string>;
  typingUsers: Map<string, Set<string>>;
}

export interface ChatStoreActions {
  loadMessages: (placeId: string) => Promise<void>;
  loadMore: (placeId: string) => Promise<void>;
  sendMessage: (placeId: string, body: string, replyToId?: string) => void;
  receiveMessage: (msg: Message) => void;
  ackMessage: (optimisticId: string, msg: Message) => void;
  failMessage: (optimisticId: string) => void;
  setTyping: (placeId: string, userId: string, isTyping: boolean) => void;
}

export type ChatStore = ChatStoreState & ChatStoreActions;

// ═══════════════════════════════════════════════════════════════
// Component Props
// ═══════════════════════════════════════════════════════════════

export interface PlaceSheetProps {
  placeId: string;
  initialSnap?: 'peek' | 'half' | 'full';
  onClose: () => void;
}

export interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showAvatar: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onLongPress: () => void;
}

export interface MapCanvasProps {
  onPlaceClick: (placeId: string) => void;
  onMoveEnd: (bbox: [number, number, number, number], zoom: number) => void;
}
