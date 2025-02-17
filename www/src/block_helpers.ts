import { BLOCK } from "./blocks.js";
import { ITEM_LABEL_MAX_LENGTH } from "./constant.js";
import { ROTATE, Vector, ObjectHelpers } from "./helpers.js";
import type {TBlock} from "./typed_blocks3.js";

export type TChestInfo = {
    pos         : Vector
    window ?    : string // имя окна, которое должно открыться для этого сундука
    block_id    : int
    extra_data  : Dict
    chestSessionId ? : number
    otherPos ?  : Vector
};

/** Структура данных, используемая во многих местах для описания сундуков */
export type TChestSlots = {
    slots : Dict<IInventoryItem>
}

export class ChestHelpers {

    /** @returns true если сундук из этого материала хранит данные в публичных слотах */
    static isPublic(material: IBlockMaterial): boolean {
        return !material.chest?.private && material.name !== 'ENDER_CHEST'
    }

    // If block is a half-chest, it returns the expected position of the other half.
    // Otherwise it returns null.
    static getSecondHalfPos(block: TBlock | null): Vector | null {
        if (!block || block.material.name !== "CHEST") {
            return null;
        }
        const dir = BLOCK.getCardinalDirection(block.rotate);
        const dxz = RIGHT_NEIGBOUR_BY_DIRECTION[dir];
        switch (block.extra_data?.type) {
            case 'left':    return block.posworld.clone().subSelf(dxz);
            case 'right':   return block.posworld.clone().addSelf(dxz);
            default:        return null;
        }
    }

    // If there are two valid half-chests, and one of them has position pos,
    // it returns a descriptor of the other half. Otherwise it returns null.
    static getSecondHalf(world: IWorld, pos: IVector): TChestInfo | null {
        const block = world.getBlock(pos);
        const secondPos = ChestHelpers.getSecondHalfPos(block);
        if (!secondPos) {
            return null;
        }
        const secondBlock = world.getBlock(secondPos);
        if (!secondBlock ||
            secondBlock.material.name !== "CHEST" ||
            secondBlock.extra_data?.type !== CHEST_HALF_OTHER_TYPE[block.extra_data.type] ||
            BLOCK.getCardinalDirection(secondBlock.rotate) !== BLOCK.getCardinalDirection(block.rotate)
        ) {
            return null;
        }
        return {
            pos: secondPos,
            block_id: secondBlock.id,
            extra_data: secondBlock.extra_data
        };
    }

    // returns a range that one chest ocupies withing a single/double chest UI
    static getOneChestRange(isFirst: boolean, hasSecond: boolean, length: int): { min: number, max: number } {
        var min = 0;
        if (hasSecond) {
            length /= 2;
            if (!isFirst) {
                min += length;
            }
        }
        return {
            min: min,
            max: min + length
        };
    }
}

const CHEST_HALF_OTHER_TYPE = {
    'left': 'right',
    'right': 'left',
};

export const RIGHT_NEIGBOUR_BY_DIRECTION = {};
RIGHT_NEIGBOUR_BY_DIRECTION[ROTATE.S] = new Vector(1, 0, 0);
RIGHT_NEIGBOUR_BY_DIRECTION[ROTATE.W] = new Vector(0, 0, -1);
RIGHT_NEIGBOUR_BY_DIRECTION[ROTATE.N] = new Vector(-1, 0, 0);
RIGHT_NEIGBOUR_BY_DIRECTION[ROTATE.E] = new Vector(0, 0, 1);

/**
 * It tests whether a player is to far away to interct with a block, or both blocks.
 * It's not exactly like pickat, and uses a margin to avoid false negatives.
 */
export function isBlockRoughlyWithinPickatRange(player, margin, pos, pos2 = null) {
    const maxDist = player.game_mode.getPickatDistance() + margin;
    const eyePos = player.getEyePos();
    const blockCenter = new Vector(pos).addScalarSelf(0.5, 0.5, 0.5);
    if (eyePos.distance(blockCenter) <= maxDist) {
        return true;
    }
    if (pos2) {
        blockCenter.copyFrom(pos2).addScalarSelf(0.5, 0.5, 0.5);
        return eyePos.distance(blockCenter) <= maxDist;
    }
    return false;
}

export class ItemHelpers {

    /**
     * Если эта строка передается в {@link setLabel}, ничего не происходит.
     * Ее нельзя ввести случайно, но даже если игрок ее специально введет, это ничего не поломает.
     */
    static LABEL_NO_CHANGE = 'no\u0000change'

    /**
     * Validates and possibly changes (possibly to null) a label entered by a user.
     * @return a valid value for label that can be passed to {@link setLabel}
     * @throws if the string can't be used as label
     * @todo better validation
     */
    static validateAndPreprocessLabel(label: string): string | null {
        // validate the label (it's for the server; the client validates before that)
        if (typeof label !== 'string' ||
            label.length > ITEM_LABEL_MAX_LENGTH
        ) {
            throw `error_incorrect_value|label=${label}`
        }
        label = label.trim();
        return label !== '' ? label : null;
    }

    static getLabel(item: IInventoryItem): string {
        return item.extra_data?.label ?? BLOCK.fromId(item.id).title;
    }

    static setLabel(item: IInventoryItem, label: string | null): void {
        if (label !== this.LABEL_NO_CHANGE) {
            this.setExtraDataField(item, 'label', label);
        }
    }

    static setExtraDataField(item: IInventoryItem, fieldName: string, value: any): void {
        if (value != null) {
            item.extra_data = item.extra_data ?? {};
            item.extra_data[fieldName] = value;
        } else {
            this.deleteExtraDataField(item, fieldName);
        }
    }

    static deleteExtraDataField(item: IInventoryItem, fieldName: string): void {
        if (item.extra_data) {
            delete item.extra_data[fieldName];
            if (ObjectHelpers.isEmpty(item.extra_data)) {
                delete item.extra_data;
            }
        }
    }

    /** @return the existing value, or the newly set value */
    static getOrSetExtraDataField(item, fieldName, defaultValue) {
        const ex = item.extra_data && item.extra_data[fieldName];
        if (ex != null) {
            return ex;
        }
        if (typeof defaultValue === 'function') {
            defaultValue = defaultValue();
        }
        this.setExtraDataField(item, fieldName, defaultValue);
        return defaultValue;
    }

    /** @return the existing value of type Object, or the newly set {} value */
    static getOrSetExtraDataFieldObject(item, fieldName) {
        item.extra_data = item.extra_data ?? {};
        let result = item.extra_data[fieldName];
        if (!result) {
            item.extra_data[fieldName] = result = {};
        }
        return result;
    }

    static incrementExtraDataField(item, fieldName, delta = 1) {
        item.extra_data = item.extra_data ?? {};
        item.extra_data[fieldName] = (item.extra_data[fieldName] ?? 0) + delta;
    }
}

/**
 * @param {Chunk|ServerChunk|ChunkWorkerChunk} chunk
 * @param {AABB} clampedAABB - in the chunk coordinate system, clamped to the clunk's size
 * @param {ShiftedMatrix|undefined} outYMatrix - for each (x, y) - the found Y
 * @param {int} setpXZ - a tweak to make the algorithm less precise, but faster
 * @param {int} setpY - a tweak to make the algorithm less precise, but faster
 * @return {int} y of the lowest non-solid block that ha only non-solid blocks above it in the given volume.
 *   It scans blocks from above.
 *   It ignores blocks below the 1st enocountered solid block (e.g. it ignores caverns below the surface).
 *   If there is no such block in {@link clampedAABB}, it returns clampedAABB.y_max.
 */
export function findLowestNonSolidYFromAboveInChunkAABBRelative(chunk, clampedAABB, outYMatrix = null, setpXZ = 2, stepY = 2) {
    const bm = chunk.chunkManager.block_manager
    const {relativePosToChunkIndex_s} = chunk.chunkManager.grid.math;
    if (outYMatrix) {
        setpXZ = 1
    }
    if (stepY !== 2 && stepY !== 1) {
        throw new Error()
    }
    const ids = chunk.tblocks.id
    const CHUNK_CY = chunk.tblocks.dataChunk.cy // if we import it as constant, static initialization order breaks somewhere else :(
    let yMin = clampedAABB.y_max
    const y_max_incl = yMin - 1
    for(let x = clampedAABB.x_min; x < clampedAABB.x_max; x += setpXZ) {
        for(let z = clampedAABB.z_min; z < clampedAABB.z_max; z += setpXZ) {
            let ind = relativePosToChunkIndex_s(x, y_max_incl, z)
            let y = y_max_incl
            let currentStepY = stepY
            // find the highest solid block
            while(y >= clampedAABB.y_min) {
                if (bm.isSolidID(ids[ind])) {
                    // increase precision to 1 block
                    if (currentStepY !== 1 && y !== y_max_incl && bm.isSolidID(ids[ind + CHUNK_CY])) {
                        y++
                    }
                    break
                }
                if (y - 1 === clampedAABB.y_min) { // make the final stpep smaller if necessary
                    currentStepY = 1
                }
                ind -= currentStepY * CHUNK_CY
                y -= currentStepY
            }
            y++ // the lowest non-solid block above a solid block
            outYMatrix?.set(x, z, y)
            if (yMin > y) {
                if (!outYMatrix && y === clampedAABB.y_min) {
                    return y // there is nothing more to search
                }
                yMin = y
            }
        }
    }
    return yMin
}