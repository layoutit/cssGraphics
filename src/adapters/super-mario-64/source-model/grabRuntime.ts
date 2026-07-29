import {
  gdInverseMatrix,
  gdVectorMagnitude,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import {
  TITLE_HEAD_PICKING_RUNTIME_SCHEMA,
  type TitleHeadPickingRuntime,
} from "./picking.js";
import { fail, matrix, vec3 } from "./contract.js";

export const TITLE_HEAD_GRAB_RUNTIME_SCHEMA =
  "cssgraphics.title-head-grab-runtime.v1" as const;

const DISPLACEMENT_DIVISOR = 1000;
const f32 = Math.fround;

interface RuntimeGrabber {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly initialMatrix: GoddardMat4;
  readonly attachmentIds: readonly string[];
}

export interface TitleHeadGrabRuntime {
  readonly schema: typeof TITLE_HEAD_GRAB_RUNTIME_SCHEMA;
  readonly picking: TitleHeadPickingRuntime;
  readonly cameraRelativePosition: GoddardVec3;
  readonly inverseCameraMatrix: GoddardMat4;
  readonly displacementMagnitude: number;
  readonly grabbers: readonly RuntimeGrabber[];
}

export function createTitleHeadGrabRuntime(
  picking: TitleHeadPickingRuntime,
  cameraRelativePosition: readonly number[] = picking.camera.worldPosition,
): TitleHeadGrabRuntime {
  if (picking?.schema !== TITLE_HEAD_PICKING_RUNTIME_SCHEMA) {
    fail("Unexpected picking runtime schema.");
  }
  const relativePosition = vec3(
    cameraRelativePosition,
    "cameraRelativePosition",
  );
  const grabbers = Object.freeze(picking.grabbers.map((grabber) => Object.freeze({
    id: grabber.id,
    role: grabber.role,
    sourceOrder: grabber.sourceOrder,
    initialMatrix: matrix(
      grabber.initialRotationMatrix,
      `${grabber.id}.initialRotationMatrix`,
    ),
    attachmentIds: grabber.attachmentIds,
  })));
  return Object.freeze({
    schema: TITLE_HEAD_GRAB_RUNTIME_SCHEMA,
    picking,
    cameraRelativePosition: relativePosition,
    inverseCameraMatrix: gdInverseMatrix(picking.camera.viewMatrix),
    displacementMagnitude:
      f32(gdVectorMagnitude(relativePosition) / DISPLACEMENT_DIVISOR),
    grabbers,
  });
}
