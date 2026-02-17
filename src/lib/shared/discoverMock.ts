export type DiscoverItem = {
  id: string;
  artist: string;
  title: string;
  imageUrl?: string;
  shopName?: string;
  price?: number;
  currency?: string;
};

export const DISCOVER_MOCK_ITEMS: DiscoverItem[] = [
  {
    id: "mock-1",
    artist: "Kaws",
    title: "Companion (Flayed)",
    shopName: "Artsy Gallery",
    price: 4500,
    currency: "USD",
    imageUrl: "/artworks/kaws.jpg",
  },
  {
    id: "mock-2",
    artist: "Yayoi Kusama",
    title: "Pumpkin (Yellow)",
    shopName: "Sotheby's Contemporary",
    price: 5000,
    currency: "GBP",
    imageUrl: "/artworks/kusama.jpg",
  },
  {
    id: "mock-3",
    artist: "Banksy",
    title: "Girl with Balloon",
    shopName: "Phillips Auction House",
    price: 15000,
    currency: "GBP",
    imageUrl: "/artworks/banksy.jpg",
  },
  {
    id: "mock-4",
    artist: "Takashi Murakami",
    title: "Rainbow Flower",
    shopName: "Gagosian Gallery",
    price: 8500,
    currency: "GBP",
    imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=500&fit=crop",
  },
  {
    id: "mock-5",
    artist: "Jeff Koons",
    title: "Balloon Dog (Orange)",
    shopName: "Christie's New York",
    price: 35000,
    currency: "GBP",
    imageUrl: "https://images.unsplash.com/photo-1577083552431-6e5fd01988ec?w=400&h=500&fit=crop",
  },
  {
    id: "mock-6",
    artist: "Ai Weiwei",
    title: "Sunflower Seeds Study",
    shopName: "Lisson Gallery London",
    price: 1200,
    currency: "GBP",
    imageUrl: "https://images.unsplash.com/photo-1579541814924-49fef17c5be5?w=400&h=500&fit=crop",
  },
];
