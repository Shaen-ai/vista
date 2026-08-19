/** @deprecated Import from `@/lib/project/floorPlanDetections` instead. */
export {
  type FloorPlanDetection,
  type FloorPlanDetectionClass,
  type NormalizedFloorPlanDetection,
  CUBICASA5K_SAMPLE_FIXTURE as MOCK_FLOOR_PLAN_DETECTION_PAYLOAD,
  CUBICASA5K_SAMPLE_NORMALIZED as NORMALIZED_FLOOR_PLAN_DETECTIONS,
  CUBICASA5K_SAMPLE_FIXTURE as SAMPLE_FLOOR_PLAN_DETECTIONS,
  buildNormalizedOverlay,
  normalizeFloorPlanDetections,
  parseRoboflowDetectPayload,
  parseRoboflowDetectResponse,
  fetchCubicasaSamplePlanFile,
} from "./floorPlanDetections";
