import { test } from "node:test";
import assert from "node:assert/strict";
import { masterIpAdapterScale, viewpointIpAdapterScale } from "./falIpAdapterScale";

test("viewpointIpAdapterScale defaults to 0.45", () => {
  const prev = process.env.VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE;
  delete process.env.VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE;
  try {
    assert.equal(viewpointIpAdapterScale(), 0.45);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE;
    else process.env.VISTA_FAL_VIEWPOINT_IP_ADAPTER_SCALE = prev;
  }
});

test("masterIpAdapterScale defaults to 0.60", () => {
  const prev = process.env.VISTA_FAL_MASTER_IP_ADAPTER_SCALE;
  delete process.env.VISTA_FAL_MASTER_IP_ADAPTER_SCALE;
  try {
    assert.equal(masterIpAdapterScale(), 0.6);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_MASTER_IP_ADAPTER_SCALE;
    else process.env.VISTA_FAL_MASTER_IP_ADAPTER_SCALE = prev;
  }
});
