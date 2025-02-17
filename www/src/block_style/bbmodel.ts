import { calcRotateMatrix, DIRECTION, FastRandom, Helpers, IndexedColor, mat4ToRotate, QUAD_FLAGS, StringHelpers, Vector } from '../helpers.js';
import { AABB } from '../core/AABB.js';
import { BlockManager, FakeTBlock, FakeVertices } from '../blocks.js';
import { TBlock } from '../typed_blocks3.js';
import { BlockStyleRegInfo } from '../block_style/default.js';
import { default as stairs_style } from '../block_style/stairs.js';
import { default as cube_style } from '../block_style/cube.js';
import { default as pot_style } from '../block_style/pot.js';
import { default as pointed_dripstone_style } from '../block_style/pointed_dripstone.js';
import { default as cauldron_style } from '../block_style/cauldron.js';
import { default as sign_style } from '../block_style/sign.js';
import { default as glMatrix } from "@vendors/gl-matrix-3.3.min.js";
import { MAX_CHUNK_SQUARE } from '../chunk_const.js';
import { BLOCK_FLAG } from '../constant.js';
import type { BBModel_Model } from '../bbmodel/model.js';
import type { Biome } from '../terrain_generator/biome3/biomes.js';
import type { ChunkWorkerChunk } from '../worker/chunk.js';
import type { World } from '../world.js';
import type { Mesh_Object_BBModel } from '../mesh/object/bbmodel.js';
import { BBModel_Cube } from '../bbmodel/cube.js';
import { BBModel_Group } from '../bbmodel/group.js';
import { default as default_style } from '../block_style/default.js';
import { CubeSym } from '../core/CubeSym.js';

const { mat4, vec3 } = glMatrix;
const lm = IndexedColor.WHITE;
// const DEFAULT_AABB_SIZE = new Vector(12, 12, 12)
// const pivotObj = new Vector(0.5, 0.5, 0.5)
const xyz = new Vector(0, 0, 0)
const aabb_matrix = mat4.create()
const aabb_pivot = new Vector(0.5, 0.0, 0.5)
const aabb_xyz = new Vector()
const randoms = new FastRandom('bbmodel', MAX_CHUNK_SQUARE)
const DEFAULT_SIX_ROTATE = Vector.YP.clone()
let aabb_chunk = null

function checkNot(value : boolean, not : boolean) : boolean {
    return value ? !not : not
}

class BBModel_TextureRule {
    /**
     * Texture name
     */
    name: string
    /**
     * Target group for change texture
     */
    group?: string
    /**
     * This texture apply if name calculate as empty
     */
    empty?: string
    /**
     * Conditions for apply this texture
     */
    when?: Map<string, any>
}

// Block model
export default class style {

    static block_manager : BlockManager

    static getRegInfo(block_manager : BlockManager) : BlockStyleRegInfo {
        style.block_manager = block_manager
        return new BlockStyleRegInfo(
            ['bbmodel'],
            this.func,
            this.computeAABB
        );
    }

    /**
     */
    static computeAABB(tblock : TBlock | FakeTBlock, for_physic : boolean, world : World = null, neighbours : any = null, expanded: boolean = false) : AABB[] {

        const material = tblock.material
        const bb = material.bb
        const mat_abbb = material.aabb

        // 1. if tblock has specific ABBB
        if(mat_abbb) {
            const aabb = new AABB(...mat_abbb).div(16)
            return [style.rotateAABB(aabb, tblock, for_physic, world, neighbours, expanded)]
        }

        // 2. if tblock has style calculated AABB
        const styleVariant = style.block_manager.styles.get(bb?.aabb_stylename ?? material.style_name)
        if(styleVariant?.aabb && styleVariant.aabb !== style.computeAABB) {
            return styleVariant.aabb(tblock, for_physic, world, neighbours, expanded)
        }

        // 3. default full block size AABB
        return [style.rotateAABB(new AABB(0, 0, 0, 1, 1, 1), tblock, for_physic, world, neighbours, expanded)]

    }

    static func(block : TBlock | FakeTBlock, vertices, chunk : ChunkWorkerChunk, x : number, y : number, z : number, neighbours : any, biome? : any, dirt_color? : IndexedColor, unknown : any = null, matrix? : imat4, pivot? : number[] | IVector, force_tex ? : tupleFloat4) {

        if(!block || typeof block == 'undefined') {
            return;
        }

        const bb = block.material.bb
        const model : BBModel_Model = bb.model

        if(!model) {
            return
        }

        // Not draw metablock blocks
        if(block instanceof TBlock && block.material.multiblock) {
            if(block.extra_data.relindex != -1) {
                return
            }
        }

        if(block.material.style_name == 'tall_grass') {
            if(block.extra_data?.is_head) {
                return null
            }
        }

        matrix = matrix ?? mat4.create()
        // matrix = mat4.create()

        // reset state and restore groups visibility
        model.resetBehaviorChanges()

        xyz.set(x, y, z)
        const emmited_blocks = style.applyBehavior(model, chunk, block, neighbours, matrix, biome, dirt_color, vertices, xyz)
        x = xyz.x
        y = xyz.y
        z = xyz.z

        // calc rotate matrix
        style.applyRotate(chunk, model, block, neighbours, matrix, x, y, z)

        //
        style.postBehavior(x, y, z, model, block, neighbours, pivot, matrix, biome, dirt_color, emmited_blocks)

        // Select texture
        if(bb.select_texture) {
            for(let st of bb.select_texture) {
                if(style.checkWhen(model, block, st.when)) {
                    style.selectTextureFromPalette(model, st, block)
                }
            }
        }

        let mesh = null

        if(block instanceof TBlock) {

            // 1.
            if(bb.set_animation) {
                let animation_name = null
                for(let anim of bb.set_animation) {
                    if(anim.names) {
                        const x = xyz.x % chunk.size.x
                        const y = xyz.y % chunk.size.y
                        const z = xyz.z % chunk.size.z
                        const index = Math.floor(randoms.double(Math.round(z * chunk.size.x + x + y)) * anim.names.length)
                        animation_name = style.processName(anim.names[index], block)
                        break
                    } else {
                        if(style.checkWhen(model, block, anim.when, neighbours)) {
                            animation_name = style.processName(anim.name, block)
                            break
                        }
                    }
                }
                if(animation_name) {
                    mesh = {animations: new Map(), prev_animations: new Map()}
                    for(const group_name of model.groups.keys()) {
                        mesh.animations.set(group_name, new Map())
                    }
                    model.playAnimation(animation_name, 999999, mesh as Mesh_Object_BBModel)
                }
            }

            if(block.material.multiblock) {
                const addCubesFlag = (group : BBModel_Group, flag : int) => {
                    for(const child of group.children) {
                        if(child instanceof BBModel_Cube) {
                            child.flag |= flag
                        } else if(child instanceof BBModel_Group) {
                            addCubesFlag(child, flag)
                        }
                    }
                }
                addCubesFlag(model.root, QUAD_FLAGS.FLAG_LIGHT_GRID)
            }

        }

        // if(block instanceof TBlock) {
        //     if(block.material.name == 'LEVER') {
        //         mesh = {animations: new Map(), prev_animations: new Map()}
        //         for(const group_name of model.groups.keys()) {
        //             mesh.animations.set(group_name, new Map())
        //         }
        //         const animation_name = Math.random() > .5 ? 'on' : 'off'
        //         model.playAnimation(animation_name, 0, mesh as Mesh_Object_BBModel)
        //     }
        // }

        // Add particles for block
        const particles = []
        let draw_bottom_copy = block.hasTag('draw_bottom_copy') && (neighbours?.DOWN && neighbours?.DOWN.material.layering)
        const floors = draw_bottom_copy ? 2 : 1
        for(let i = 0; i < floors; i++) {
            if(bb.animated && (typeof QubatchChunkWorker != 'undefined')) {
                let animation_name = 'idle'
                // if(block.material.chest) {
                //     let ed = block.extra_data
                //     let opened = ed.opened
                //     if(ed.opened !== undefined) {
                //         animation_name = opened ? 'open' : 'close'
                //     }
                // }
                const args : IAddMeshArgs = {
                    block_pos:          block.posworld.clone(),
                    model:              model.name,
                    animation_name:     animation_name,
                    hide_groups:        model.getHiddenGroupNames(),
                    item_block:         (block instanceof TBlock) ? block.convertToDBItem() : null,
                    matrix:             matrix,
                    rotate:             mat4ToRotate(matrix),
                }
                QubatchChunkWorker.postMessage(['add_bbmesh', args])
                return null
            } else {
                model.draw(vertices, new Vector(x + .5, y - i, z + .5), lm, matrix, (type : string, pos : Vector, args : any) => {
                    if(typeof QubatchChunkWorker == 'undefined') {
                        return
                    }
                    const p = new Vector(pos).addScalarSelf(.5, 0, .5)
                    particles.push({pos: p.addSelf(block.posworld), type, args})
                }, mesh)
            }
        }
        style.addParticles(model, block, matrix, particles)
        if(particles.length > 0) {
            QubatchChunkWorker.postMessage(['create_block_emitter', {
                block_pos:  block.posworld,
                list: particles
            }]);
        }

        // Draw debug stand
        // style.drawDebugStand(vertices, pos, lm, null);

        if(emmited_blocks.length > 0) {
            return emmited_blocks
        }

        return null

    }

    static applyRotate(chunk : ChunkWorkerChunk, model : BBModel_Model, tblock: TBlock | FakeTBlock, neighbours : any, matrix : imat4, x : int, y : int, z : int) {

        const mat = tblock.material
        const bb = mat.bb

        // Rotate
        if(bb.rotate) {
            for(let rot of bb.rotate) {
                if(style.checkWhen(model, tblock, rot.when)) {
                    switch(rot.type) {
                        case 'cardinal_direction': {
                            style.rotateByCardinal4sides(model, matrix, tblock.getCardinalDirection())
                            break
                        }
                        case 'fixed_cardinal_direction': {
                            style.rotateByCardinal4sides(model, matrix, rot.value)
                            break
                        }
                        case 'y360': {
                            if(tblock.rotate) {
                                mat4.rotateY(matrix, matrix, (tblock.rotate.x / 4) * (2 * Math.PI))
                            }
                            break
                        }
                        case 'ydeg': {
                            if(tblock.rotate) {
                                mat4.rotateY(matrix, matrix, (tblock.rotate.x / 180) * Math.PI)
                            }
                            break
                        }
                        case 'random': {
                            for(let axe of rot.axes) {
                                switch(axe) {
                                    case 'y': {
                                        mat4.rotateY(matrix, matrix, randoms.double(Math.round(z * chunk.size.x + x)) * (2 * Math.PI))
                                        break
                                    }
                                    default: {
                                        throw 'error_not_implemented'
                                    }
                                }
                            }
                            break
                        }
                        case 'flipx': {
                            mat4.translate(matrix, matrix, [0, .5, 0])
                            mat4.rotateX(matrix, matrix, Math.PI)
                            mat4.translate(matrix, matrix, [0, -.5, 0])
                            break
                        }
                        case 'cog':
                        case 'rotate_by_pos_n_6':
                        case 'six': {
                            if(tblock.rotate && (tblock instanceof TBlock || tblock instanceof FakeTBlock)) {
                                const rotate = tblock.rotate || DEFAULT_SIX_ROTATE
                                const cardinal_direction = tblock.getCardinalDirection()
                                const mx = calcRotateMatrix(tblock.material, rotate, cardinal_direction, matrix)
                                // if(rot.type == 'cog') {
                                //     mat4.rotateY(mx, mx, Math.PI / 8)
                                // }
                                // хак со сдвигом матрицы в центр блока
                                const v = vec3.create()
                                v[1] = 0.5
                                vec3.transformMat4(v, v, mx)
                                mx[12] += - v[0]
                                mx[13] += 0.5 - v[1]
                                mx[14] += - v[2]
                                mat4.copy(matrix, mx)
                            }
                            break
                        }
                        case 'three': {
                            // rotation only in three axes X, Y or Z
                            if(tblock.rotate && (tblock instanceof TBlock || tblock instanceof FakeTBlock)) {
                                const cd = tblock.getCardinalDirection()
                                const mx = calcRotateMatrix(tblock.material, tblock.rotate, cd, matrix)
                                // хак со сдвигом матрицы в центр блока
                                const v = vec3.create()
                                v[1] = 0.5
                                vec3.transformMat4(v, v, mx)
                                mx[12] += - v[0]
                                mx[13] += 0.5 - v[1]
                                mx[14] += - v[2]
                                mat4.copy(matrix, mx)
                            }
                            break
                        }
                    }
                    break
                }
            }
        }

    }

    static postBehavior(x : number, y : number, z : number, model : BBModel_Model, tblock : TBlock | FakeTBlock, neighbours, pivot, matrix : imat4, biome : Biome, dirt_color : IndexedColor, emmited_blocks: any[]) {

        const mat = tblock.material
        const bb = mat.bb

        switch(bb.behavior ?? bb.model.name) {
            case 'pointed_dripstone': {
                if(tblock instanceof TBlock) {
                    pointed_dripstone_style.postBehavior(tblock, tblock.extra_data)
                }
                break
            }
            case 'sign': {
                const m = mat4.create()
                mat4.copy(m, matrix)
                mat4.rotateY(m, m, Math.PI)
                const aabb = sign_style.makeAABBSign(tblock, x, y, z)
                const fblock = sign_style.makeTextBlock(tblock, aabb, pivot, m, x, y, z)
                if(fblock) {
                    emmited_blocks.push(fblock)
                }
                break
            }
        }

    }

    static applyBehavior(model : BBModel_Model, chunk : ChunkWorkerChunk, tblock : TBlock | FakeTBlock, neighbours : any, matrix : imat4, biome : any, dirt_color : IndexedColor, vertices : float[], xyz : Vector) {

        const bm = style.block_manager
        const blockFlags = bm.flags
        const emmited_blocks = []
        const mat = tblock.material
        const bb = mat.bb
        const behavior = bb.behavior || bb.model.name

        if(!(tblock instanceof FakeTBlock) && behavior.endsWith('_ore')) {
            const hide_groups = []
            if(neighbours.NORTH && (blockFlags[neighbours.NORTH.id] & BLOCK_FLAG.SOLID)) hide_groups.push('north')
            if(neighbours.SOUTH && (blockFlags[neighbours.SOUTH.id] & BLOCK_FLAG.SOLID)) hide_groups.push('south')
            if(neighbours.WEST && (blockFlags[neighbours.WEST.id] & BLOCK_FLAG.SOLID)) hide_groups.push('west')
            if(neighbours.EAST && (blockFlags[neighbours.EAST.id] & BLOCK_FLAG.SOLID)) hide_groups.push('east')
            if(neighbours.UP && (blockFlags[neighbours.UP.id] & BLOCK_FLAG.SOLID)) hide_groups.push('up')
            if(neighbours.DOWN && (blockFlags[neighbours.DOWN.id] & BLOCK_FLAG.SOLID)) hide_groups.push('down')
            model.hideGroups(hide_groups)
        }

        // 1.
        if(bb.set_state /* && !(tblock instanceof FakeTBlock) */) {
            for(let state of bb.set_state) {
                if(state.names) {
                    const x = xyz.x % chunk.size.x
                    const y = xyz.y % chunk.size.y
                    const z = xyz.z % chunk.size.z
                    const index = Math.floor(randoms.double(Math.round(z * chunk.size.x + x + y)) * state.names.length)
                    const name = state.names[index]
                    model.state = style.processName(name, tblock)
                    model.hideAllExcept([model.state])
                    break
                } else {
                    if(style.checkWhen(model, tblock, state.when, neighbours)) {
                        model.state = style.processName(state.name, tblock)
                        model.hideAllExcept([model.state])
                        break
                    }
                }
            }
        }

        // 2.
        switch(behavior) {
            case 'billboard': {
                if(tblock instanceof TBlock) {
                    // if(tblock.extra_data.relindex == -1) {
                    if(tblock.extra_data.texture) {
                        for(const cube of model.displays) {
                            if(bb.animated && (typeof QubatchChunkWorker != 'undefined')) {
                                const extra_data = tblock.extra_data ?? {}
                                if(!extra_data.texture?.uv) {
                                    const item = tblock.convertToDBItem()
                                    const pos = tblock.posworld
                                    item.extra_data = extra_data
                                    QubatchChunkWorker.postMessage(['create_billboard_texture', {pos, item}])
                                }
                            } else {
                                // create callback for cube
                                cube.callback = (part) : boolean => {
                                    const extra_data = tblock.extra_data ?? {}
                                    if(extra_data.texture?.url) {
                                        if(extra_data.texture?.uv) {
                                            const verts = []
                                            const {material_key, uv, tx_size} = extra_data.texture
                                            for(const fk in part.faces) {
                                                const face = part.faces[fk]
                                                face.tx_size = tx_size
                                                face.uv = [...uv]
                                            }
                                            default_style.pushPART(verts, part, Vector.ZERO)
                                            emmited_blocks.push(new FakeVertices(material_key, verts))
                                            return true
                                        }
                                        const item = tblock.convertToDBItem()
                                        const pos = tblock.posworld
                                        item.extra_data = extra_data
                                        QubatchChunkWorker.postMessage(['create_billboard_texture', {pos, item}])
                                    }
                                    return false
                                }
                            }
                        }
                    }
                }
                break
            }
            case 'jukebox': {
                cube_style.playJukeboxDisc(chunk, tblock, xyz.x, xyz.y, xyz.z)
                break
            }
            case 'door': {
                const extra_data = tblock.extra_data ?? {opened: false, left: true}
                const rotate = tblock.rotate ?? Vector.ZERO
                const is_left = extra_data.left
                const shift = 7/16 * (is_left ? 1 : -1)
                const move_back = !(tblock instanceof FakeTBlock)
                if(extra_data) {
                    if(is_left) {
                        mat4.rotateY(matrix, matrix, Math.PI)
                    }
                    if(extra_data?.opened) {
                        mat4.rotateY(matrix, matrix, Math.PI/2 * (is_left ? -1 : 1))
                    }
                    switch(rotate.x) {
                        case DIRECTION.SOUTH: {
                            xyz.x -= shift
                            if(move_back) xyz.z -= 7/16
                            break
                        }
                        case DIRECTION.NORTH: {
                            xyz.x += shift
                            if(move_back) xyz.z += 7/16
                            break
                        }
                        case DIRECTION.WEST: {
                            xyz.z += shift
                            if(move_back) xyz.x -= 7/16
                            break
                        }
                        case DIRECTION.EAST: {
                            xyz.z -= shift
                            if(move_back) xyz.x += 7/16
                            break
                        }
                    }
                }
                break
            }
            case 'cactus': {
                if(!(tblock instanceof FakeTBlock)) {
                    if(neighbours.UP && neighbours.UP.id != tblock.id) {
                        model.hideAllExcept(['top'])
                    }
                }
                break
            }
            case 'age': {
                const age = Math.min((tblock?.extra_data?.stage ?? 0), mat.ticking.max_stage) + 1
                model.state = `age${age}`
                model.hideAllExcept([model.state])
                break
            }
            case "pane": {
                const except_list = ['column']
                if (bm.canPaneConnect(neighbours.EAST)) except_list.push('east')
                if (bm.canPaneConnect(neighbours.WEST)) except_list.push('west')
                if (bm.canPaneConnect(neighbours.SOUTH)) except_list.push('south')
                if (bm.canPaneConnect(neighbours.NORTH)) except_list.push('north')
                model.hideAllExcept(except_list)
                break
            }
            case 'chest': {
                const type = tblock.extra_data?.type ?? null
                const is_big = !!type
                if(is_big) {
                    if(type == 'left') {
                        model.hideGroups(['small', 'big'])
                    } else {
                        model.hideGroups(['small'])
                    }
                } else {
                    model.hideGroups(['big'])
                }

                break
            }
            case 'fence': {
                const hide_group_names = [];
                if(!bm.canFenceConnect(neighbours.SOUTH)) hide_group_names.push('south')
                if(!bm.canFenceConnect(neighbours.NORTH)) hide_group_names.push('north')
                if(!bm.canFenceConnect(neighbours.WEST)) hide_group_names.push('west')
                if(!bm.canFenceConnect(neighbours.EAST)) hide_group_names.push('east')
                model.hideGroups(hide_group_names)
                style.selectTextureFromPalette(model, {name: mat.name}, tblock)
                break
            }
            case 'wall': {
                const hide_group_names = [];
                if(!bm.canWallConnect(neighbours.SOUTH)) hide_group_names.push('south')
                if(!bm.canWallConnect(neighbours.NORTH)) hide_group_names.push('north')
                if(!bm.canWallConnect(neighbours.WEST)) hide_group_names.push('west')
                if(!bm.canWallConnect(neighbours.EAST)) hide_group_names.push('east')
                model.hideGroups(hide_group_names)
                // style.selectTextureFromPalette(model, {name: mat.name}, tblock)
                break
            }
            case 'pot': {
                if(!(tblock instanceof FakeTBlock)) {
                    emmited_blocks.push(...pot_style.emmitInpotBlock(tblock.vec.x, tblock.vec.y, tblock.vec.z, tblock, null, matrix, biome, dirt_color))
                }
                break
            }
            case 'stairs': {

                const info      = stairs_style.calculate(tblock, Vector.ZERO.clone(), neighbours)
                const on_ceil   = info.on_ceil
                const fix_rot   = on_ceil ? Math.PI / 2 : 0
                const sw        = !!info.sides[DIRECTION.SOUTH] ? 1 : 0
                const se        = !!info.sides[DIRECTION.EAST] ? 1 : 0
                const en        = !!info.sides[DIRECTION.NORTH] ? 1 : 0
                const nw        = !!info.sides[DIRECTION.WEST] ? 1 : 0

                const rules : [float, float, float, float, string[], float][] = [
                    // between
                    [0, 1, 1, 0, ['inner', 'outer'], Math.PI],
                    [1, 1, 0, 0, ['inner', 'outer'], Math.PI / 2],
                    [0, 0, 1, 1, ['inner', 'outer'], -Math.PI / 2],
                    [1, 0, 0, 1, ['inner', 'outer'], 0],
                    // outer
                    [0, 1, 0, 0, ['between', 'inner'], Math.PI / 2 + fix_rot],
                    [0, 0, 1, 0, ['between', 'inner'], Math.PI + fix_rot],
                    [0, 0, 0, 1, ['between', 'inner'], -Math.PI / 2 + fix_rot],
                    [1, 0, 0, 0, ['between', 'inner'], fix_rot],
                    // inner
                    [1, 1, 1, 0, ['between', 'outer'], Math.PI / 2 + fix_rot],
                    [0, 1, 1, 1, ['between', 'outer'], Math.PI + fix_rot],
                    [1, 0, 1, 1, ['between', 'outer'], -Math.PI / 2 + fix_rot],
                    [1, 1, 0, 1, ['between', 'outer'], fix_rot],
                ]

                let rotY = 0
                for(let rule of rules) {
                    if(en == rule[0] && se == rule[1] && sw == rule[2] && nw == rule[3]) {
                        model.hideGroups(rule[4])
                        rotY = rule[5]
                        break
                    }
                }

                if(rotY) {
                    mat4.rotateY(matrix, matrix, rotY)
                }

                if(on_ceil) {
                    mat4.translate(matrix, matrix, [0, 1, 0]);
                    mat4.rotateZ(matrix, matrix, Math.PI)
                }

                break
            }
            case 'cauldron': {
                if(tblock.extra_data) {
                    const vert = []
                    cauldron_style.func(tblock, vert, null, xyz.x, xyz.y, xyz.z, neighbours, biome, dirt_color, true, matrix, undefined, null)
                    emmited_blocks.push(new FakeVertices(bm.STONE.material_key, vert))
                }
                break
            }
        }

        return emmited_blocks

    }

    static rotateByCardinal4sides(model : BBModel_Model, matrix : imat4, cardinal_direction : int) {
        CubeSym.applyToMat4(matrix, matrix, cardinal_direction);

        /*switch(cardinal_direction) {
            case DIRECTION.SOUTH:
                mat4.rotateY(matrix, matrix, Math.PI);
                break;
            case DIRECTION.WEST:
                mat4.rotateY(matrix, matrix, -Math.PI / 2);
                break;
            case DIRECTION.EAST:
                mat4.rotateY(matrix, matrix, Math.PI / 2);
                break;
        }*/
    }

    static addParticles(model : BBModel_Model, tblock : TBlock | FakeTBlock, matrix : imat4, particles) {
        if(!Helpers.inWorker()) {
            return
        }
        const mat = tblock.material
        const block_particles = mat.bb?.particles
        if(!block_particles) {
            return
        }
        //
        for(let particle of block_particles) {
            if(style.checkWhen(model, tblock, particle.when)) {
                const args = null
                for(let item of particle.list) {
                    const p = new Vector(item).addScalarSelf(-.5, 0, -.5)
                    const arr = p.toArray()
                    vec3.transformMat4(arr, arr, matrix)
                    p.set(arr[0], arr[1], arr[2]).addScalarSelf(.5, 0, .5)
                    particles.push({pos: p.addSelf(tblock.posworld), type: item.type, args})
                }
            }
        }
    }

    static checkWhen(model : BBModel_Model, tblock : TBlock | FakeTBlock, when : object, neighbours? : any) : boolean {
        if(!when) {
            return true
        }
        for(let k in when) {
            const not = k.startsWith('!')
            const condition_value = when[k]
            if(not) {
                k = k.substring(1)
            }
            switch(k) {
                case 'state': {
                    if(checkNot(Array.isArray(condition_value) ? !condition_value.includes(model.state) : (model.state !== condition_value), not)) {
                        return false
                    }
                    break
                }
                case 'rotate.y': {
                    if(checkNot(tblock.rotate?.y !== condition_value, not)) {
                        return false
                    }
                    break
                }
                case 'sign:samerot': {
                    if(checkNot(sign_style.same_rot_with_up_neighbour(tblock, neighbours.UP) != condition_value, not)) {
                        return false
                    }
                    break
                }
                default: {
                    if(k.startsWith('neighbour.')) {
                        const temp = k.split('.')
                        // Examples: "when": {"neighbour.up.material.name": "AIR"}
                        //           "when": {"neighbour.up.material.is_solid": true}
                        if(temp.length != 4) {
                            return false
                        }
                        const nname = temp[1].toUpperCase()
                        const n = neighbours[nname]
                        if(!n) {
                            return false
                        }
                        const property_name = temp[3]
                        const nmat = n.material
                        if(checkNot((!nmat || n.material[property_name] != condition_value), not)) {
                            return false
                        }
                    } else if(k.startsWith('extra_data.')) {
                        const key = k.substring(11)
                        const value = tblock.extra_data ? (tblock.extra_data[key] ?? null) : null
                        if(Array.isArray(condition_value)) {
                            if(checkNot(!condition_value.includes(value), not)) {
                                return false
                            }
                        } else {
                            if(checkNot(condition_value != value, not)) {
                                return false
                            }
                        }
                    }
                }
            }
        }
        return true
    }

    static processName(name : string, tblock : TBlock | FakeTBlock) : string {
        name = name.replace('%block_name%', tblock.material.name)
        if(name.startsWith('%extra_data.')) {
            const field_name = StringHelpers.trim(name.substring(12), '%')
            name = undefined
            if(tblock.extra_data) {
                name = tblock.extra_data[field_name]
            }
        }
        return name === undefined ? null : name + ''
    }

    static selectTextureFromPalette(model : BBModel_Model, texture : BBModel_TextureRule, tblock : TBlock | FakeTBlock) {
        //
        const makeTextureName = (name : string) => {
            if(!name) {
                return
            }
            if(tblock && tblock.material) {
                name = style.processName(name, tblock)
            }
            // if(tblock && tblock.material) {
            //     name = name.replace('%block_name%', tblock.material.name)
            //     if(name.startsWith('%extra_data.')) {
            //         const field_name = StringHelpers.trim(name.substring(12), '%')
            //         name = null
            //         if(tblock.extra_data) {
            //             name = tblock.extra_data[field_name]
            //         }
            //     }
            // }
            return name
        }
        //
        const texture_name = makeTextureName(texture.name) || makeTextureName(texture.empty)
        if(texture_name) {
            model.selectTextureFromPalette(texture.group, texture_name)
        }
    }

    static rotateAABB(aabb : AABB, tblock : TBlock | FakeTBlock, for_physic : boolean, world : World = null, neighbours : any = null, expanded: boolean = false) : AABB {

        if(tblock instanceof TBlock) {
            const grid = world.grid
            grid.math.worldPosToChunkPos(tblock.posworld, aabb_xyz)
            const {x, y, z} = aabb_xyz
            if(!aabb_chunk) {
                aabb_chunk = {size: grid.chunkSize}
            }
            mat4.identity(aabb_matrix)
            style.applyRotate(aabb_chunk as ChunkWorkerChunk, tblock.material.bb.model, tblock, neighbours, aabb_matrix, x, y, z)
            aabb.applyMat4(aabb_matrix, aabb_pivot)
        }

        return aabb

    }

    // Stand
    // static drawDebugStand(vertices, pos, lm, matrix) {
    //     const bm = style.block_manager
    //     const flag = 0;
    //     const stone = bm.calcTexture(bm.STONE.texture, DIRECTION.WEST);
    //     const stand = [];
    //     stand.push(...[
    //         // stand
    //         {
    //             "size": {"x": 16, "y": .5, "z": 16},
    //             "translate": {"x":0, "y": -7.5, "z": 0},
    //             "faces": {
    //                 "up": {"uv": [8, 8], "flag": flag, "texture": stone},
    //                 "down": {"uv": [8, 8], "flag": flag, "texture": stone},
    //                 "north": {"uv": [8, 8], "flag": flag, "texture": stone},
    //                 "south": {"uv": [8, 8], "flag": flag, "texture": stone},
    //                 "west":  {"uv": [8, 8], "flag": flag, "texture": stone},
    //                 "east":  {"uv": [8, 8], "flag": flag, "texture": stone}
    //             }
    //         }
    //     ]);
    //     for(const el of stand) {
    //         default_style.pushPART(vertices, {
    //             ...el,
    //             lm:         lm,
    //             pos:        pos,
    //             matrix:     matrix
    //         });
    //     }
    // }

}