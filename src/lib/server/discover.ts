import { DISCOVER_MOCK_ITEMS, type DiscoverItem } from "@/lib/shared/discoverMock";

export async function discoverForArtists(artists: string[]): Promise<DiscoverItem[]> {
  if (!artists.length) return [];
  const followed = artists.map((a) => a.trim().toLowerCase()).filter(Boolean);
  return DISCOVER_MOCK_ITEMS.filter((item) =>
    followed.some((artist) => {
      const candidate = item.artist.toLowerCase();
      return candidate.includes(artist) || artist.includes(candidate);
    })
  );
}
