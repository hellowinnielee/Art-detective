export type ConfidenceStatus = "Good" | "Needs review" | "Missing evidence";
export type RecommendedAction = "Proceed" | "Ask seller for docs" | "Wait/monitor";

export interface SnapshotBucketCheck {
  label: string;
  value: "Good" | "Needs review" | "Missing evidence";
  detail: string;
}

export interface SnapshotBucket {
  key: "authenticity" | "provenance" | "price" | "risk" | "visual";
  label: string;
  score: number;
  weight: number;
  status: ConfidenceStatus;
  checks: SnapshotBucketCheck[];
  explanation: string;
}

export interface ListingRecord {
  listingId: string;
  source: string;
  url: string;
  fetchedAt: string;
  currency: string;
  price?: number;
  artwork: {
    title?: string;
    dimensions?: string;
    medium?: string;
    yearOfRelease?: string;
  };
  artist: {
    name?: string;
  };
  visual: {
    imageUrls: string[];
  };
}

export interface SnapshotResponseBody {
  source: string;
  snapshot: {
    listingId: string;
    score: number;
    status: ConfidenceStatus;
    recommendedAction: RecommendedAction;
    topPositiveSignals: string[];
    topMissingOrSuspiciousSignals: string[];
    buckets: SnapshotBucket[];
  };
  artworkOverview: {
    imageUrls: string[];
    artistName: string;
    title: string;
    dimensions: string;
    price?: number;
    currency: string;
    medium: string;
    yearOfRelease: string;
  };
}
