export async function loadFlow(id: string) {
  const res = await fetch(`/flows/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load flow ${id}`);
  }
  return res.json();
}
