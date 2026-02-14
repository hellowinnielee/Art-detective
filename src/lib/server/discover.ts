export type DiscoverItem = {
  id: string;
  artist: string;
  title: string;
  year?: string;
  medium?: string;
  source: string;
  sourceUrl: string;
  imageUrl?: string;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function fromArtInstitute(artist: string): Promise<DiscoverItem[]> {
  const q = encodeURIComponent(artist);
  const response = await withTimeout(
    fetch(
      `https://api.artic.edu/api/v1/artworks/search?q=${q}&fields=id,title,artist_title,date_display,medium_display,image_id&limit=2`
    )
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    data?: Array<{ id: number; title?: string; artist_title?: string; date_display?: string; medium_display?: string; image_id?: string }>;
  };
  return (payload.data ?? [])
    .filter((item) => item.title)
    .map((item) => ({
      id: `artic-${item.id}`,
      artist: item.artist_title ?? artist,
      title: item.title ?? "Untitled",
      year: item.date_display,
      medium: item.medium_display,
      source: "Art Institute of Chicago API",
      sourceUrl: `https://www.artic.edu/artworks/${item.id}`,
      imageUrl: item.image_id ? `https://www.artic.edu/iiif/2/${item.image_id}/full/843,/0/default.jpg` : undefined,
    }));
}

async function fromMet(artist: string): Promise<DiscoverItem[]> {
  const q = encodeURIComponent(artist);
  const search = await withTimeout(
    fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${q}`)
  );
  if (!search.ok) return [];
  const searchPayload = (await search.json()) as { objectIDs?: number[] };
  const ids = (searchPayload.objectIDs ?? []).slice(0, 2);
  const detailed: Array<DiscoverItem | null> = await Promise.all(
    ids.map(async (id) => {
      const response = await withTimeout(fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`));
      if (!response.ok) return null;
      const detail = (await response.json()) as {
        objectID?: number;
        title?: string;
        artistDisplayName?: string;
        objectDate?: string;
        medium?: string;
        objectURL?: string;
        primaryImageSmall?: string;
      };
      if (!detail.objectID || !detail.title) return null;
      return {
        id: `met-${detail.objectID}`,
        artist: detail.artistDisplayName || artist,
        title: detail.title,
        year: detail.objectDate,
        medium: detail.medium,
        source: "The Met Collection API",
        sourceUrl: detail.objectURL ?? `https://www.metmuseum.org/art/collection/search/${detail.objectID}`,
        imageUrl: detail.primaryImageSmall || undefined,
      };
    })
  );
  return detailed.filter((item): item is DiscoverItem => item !== null);
}

export async function discoverForArtists(artists: string[]): Promise<DiscoverItem[]> {
  const input = [...new Set(artists.map((a) => a.trim()).filter(Boolean))].slice(0, 8);
  const grouped = await Promise.all(
    input.map(async (artist) => {
      const [a, b] = await Promise.allSettled([fromArtInstitute(artist), fromMet(artist)]);
      return [...(a.status === "fulfilled" ? a.value : []), ...(b.status === "fulfilled" ? b.value : [])];
    })
  );
  return grouped.flat();
}
