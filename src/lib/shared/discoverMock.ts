export type DiscoverItem = {
  id: string;
  artist: string;
  title: string;
  imageUrl?: string;
  shopName?: string;
  price?: number;
  currency?: string;
};

export type CuratedArtworkItem = {
  id: string;
  artist: string;
  title: string;
  source: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  isAvailable: boolean;
};

export const DISCOVER_MOCK_ITEMS: DiscoverItem[] = [
  {
    id: "mock-1",
    artist: "Kaws",
    title: "Companion (Flayed)",
    shopName: "Artsy Gallery",
    price: 4500,
    currency: "USD",
    imageUrl: "/artists/artist-kaws.jpg",
  },
  {
    id: "mock-2",
    artist: "Yayoi Kusama",
    title: "Pumpkin (Yellow)",
    shopName: "Sotheby's Contemporary",
    price: 5000,
    currency: "GBP",
    imageUrl: "/artists/artist-kusama.jpg",
  },
  {
    id: "mock-3",
    artist: "Banksy",
    title: "Girl with Balloon",
    shopName: "Phillips Auction House",
    price: 15000,
    currency: "GBP",
    imageUrl: "/artists/artist-banksy.jpg",
  },
  {
    id: "mock-4",
    artist: "Takashi Murakami",
    title: "Rainbow Flower",
    shopName: "Gagosian Gallery",
    price: 8500,
    currency: "GBP",
    imageUrl: "/artists/artist-murakami.jpg",
  },
  {
    id: "mock-5",
    artist: "Jeff Koons",
    title: "Balloon Dog (Orange)",
    shopName: "Christie's New York",
    price: 35000,
    currency: "GBP",
    imageUrl: "/artists/artist-jeffkoons.jpg",
  },
  {
    id: "mock-6",
    artist: "Ai Weiwei",
    title: "Sunflower Seeds Study",
    shopName: "Lisson Gallery London",
    price: 1200,
    currency: "GBP",
    imageUrl: "/artists/artist-aiweiwei.jpg",
  },
];

export const CURATED_ARTWORKS_MOCK_ITEMS: CuratedArtworkItem[] = [
  {
    id: "curated-1",
    artist: "Yayoi Kusama",
    title: "A Pumpkin BY",
    source: "Fairart",
    price: 5680,
    currency: "GBP",
    imageUrl: "/artworks/kusama.jpg",
    isAvailable: true,
  },
  {
    id: "curated-2",
    artist: "Banksy",
    title: "Girl with Balloon (Signed)",
    source: "Artsy",
    price: 25000,
    currency: "GBP",
    imageUrl: "/artworks/banksy.jpg",
    isAvailable: true,
  },
  {
    id: "curated-3",
    artist: "Ai Weiwei",
    title: "Coca-Cola Glass Vase (Red)",
    source: "Perrotin",
    price: 2400,
    currency: "GBP",
    imageUrl: "/artists/artist-aiweiwei.jpg",
    isAvailable: true,
  },
  {
    id: "curated-4",
    artist: "Kaws",
    title: "Presenting The Past",
    source: "Ebay",
    price: 12000,
    currency: "GBP",
    imageUrl: "/artworks/kaws.jpg",
    isAvailable: true,
  },
];
