function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function masterIpAdapterScale(): number {
  return num("VISTA_FAL_MASTER_IP_ADAPTER_SCALE", 0.6);
}

export function viewpointIpAdapterScale(): number {
  return num("VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE", 0.45);
}
