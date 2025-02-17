// ///<reference types='vauxcel'/>

import type {Vector} from '../helpers.js';
import {ShaderPreprocessor} from "./ShaderPreprocessor.js";
import type {GeometryTerrain} from '../geometry_terrain.js';
import type {WebGLMaterial} from './webgl/WebGLMaterial.js';
import {BLEND_MODES, Geometry, LayerPass, RenderTexture, Buffer, Renderer, State, BatchSystem} from 'vauxcel';
import {GlobalUniformGroup, LightUniformGroup} from "./uniform_groups.js";
import glMatrix from "@vendors/gl-matrix-3.3.min.js";
import {BufferBaseTexture, BufferBaseTexture3D} from "./BufferBaseTexture.js";

const {mat4} = glMatrix;

export interface PassOptions {
    fogColor?: [number, number, number, number]
    clearColor?: boolean
    clearDepth?: boolean
    target: RenderTexture
    viewport?: [number, number, number, number]
}

export class CubeMesh {
    shader: any;
    geom: any;
    state: State;

    constructor(shader, geom) {
        this.shader = shader;
        this.geom = geom;
        this.state = new State();
        this.state.blendMode = BLEND_MODES.NORMAL_NPM;
    }

    get lookAt() {
        return this.shader.lookAt;
    }

    get proj() {
        return this.shader.proj;
    }

    draw (lookAtMatrix, projMatrix, width, height) {
        const {
            lookAt, proj
        } = this;

        mat4.copy(proj, projMatrix);
        mat4.copy(lookAt, lookAtMatrix);
        // mat4.rotate(lookAt, lookAt, Math.PI / 2, [1, 0, 0]);

        lookAt[12] = 0;
        lookAt[13] = 0;
        lookAt[14] = 0;

        this.shader.resolution = [width, height];
        this.shader.context.drawCube(this);
    }
}

export class BaseCubeGeometry extends Geometry {
    [key: string]: any;

    context: BaseRenderer;
    options: any;
    vertex: Buffer;
    constructor(context, options) {
        super();
        this.context = context;
        this.options = options;

        this.initBuffers();
    }

    initBuffers()
    {
        this.vertex = new Buffer(new Float32Array([
            -1, -1, 1,
            1, -1, 1,
            1, 1, 1,
            -1, 1, 1,
            -1, -1, -1,
            1, -1, -1,
            1, 1, -1,
            -1, 1, -1
        ]), true);

        this.addAttribute('a_vertex', this.vertex, 3);

        this.addIndex(new Buffer(new Uint16Array([
            0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4,
            1, 5, 6, 6, 2, 1, 0, 4, 7, 7, 3, 0,
            3, 2, 6, 6, 7, 3, 0, 1, 5, 5, 4, 0
        ]), true, true));
    }
}

export class BaseRenderer {
    [key: string]: any;

    batch : BatchSystem = null;
    preprocessor = new ShaderPreprocessor();
    pixiRender: Renderer = null;

    /**
     *
     * @param {HTMLCanvasElement} view
     * @param {*} options
     */
    constructor(view, options) {
        this.view = view;
        this.options = options;
        this.size = {
            width: 0,
            height: 0
        };
        this.stat = {
            drawcalls: 0,
            drawquads: 0,
            multidrawcalls: 0,
        };

        /**
         * @type {[number, number, number, number]}
         */
        this._clearColor = [0,0,0,0];

        /**
         * @type {[number, number, number, number]}
         */
        this._viewport = [0,0,0,0];

        /**
         * @type {BaseRenderTarget}
         */
        this._target = null;

        this._activeTextures = {};

        /**
         * @type {BaseTexture[]}
         */
        this._textures = [];

        this._buffers = {};

        this._emptyTex = new BufferBaseTexture({ data: new Uint8Array(4),
            width: 1, height: 1});
        this._emptyTexInt = new BufferBaseTexture( { data: new Int32Array(4),
            width: 1, height: 1});
        this._emptyTex3D = new BufferBaseTexture3D({ data: new Uint8Array(4),
            width: 1, height: 1, depth: 1});
        this._emptyTex3DInt = new BufferBaseTexture3D({ data: new Int32Array(4),
            width: 1, height: 1, depth: 1});

        this.globalUniforms = new GlobalUniformGroup();
        this.lightUniforms = new LightUniformGroup();
        /**
         * @type {{[key: string]: string}}
         */
        if (options.defines) {
            this.preprocessor.global_defines = Object.assign({}, options.defines);
        }

        this.state3d = BaseRenderer.create3dState();

        this.multidrawExt = null;
    }

    static create3dState() {
        const state = new State();
        state.blendMode = BLEND_MODES.NORMAL_NPM;
        state.depthTest = true;
        state.culling = true;
        return state;
    }

    get kind() {
        return (this.constructor as any).kind;
    }

    async init(options: { shaderPreprocessor?: ShaderPreprocessor} = {}) {
        if (options.shaderPreprocessor) {
            this.preprocessor.merge(options.shaderPreprocessor);
        }
        if (Object.keys(this.preprocessor.blocks).length === 0) {
            console.warn('Shader blocks is empty');
        }
    }

    _onReplace(replace, offset, string, args = {}) {
        const {
            blocks
        } = this;

        const key = replace.trim();

        if (!(key in blocks)) {
            throw '[Preprocess] Block for ' + key + 'not found';
        }

        // compute pad spaces
        let pad = 0;
        for(pad = 0; pad < 32; pad ++) {
            if (string[offset - pad - 1] !== ' ') {
                break;
            }
        }

        let block = blocks[key]
            .split('\n')
            // we should skip first block because pad applied in repalce
            .map((e, i) => (' '.repeat(i === 0 ? 0 : pad) + e))
            .join('\n');

        const defines = args[key] || {};

        if (defines.skip) {
            return '// skip block ' + key;
        }

        for(const argkey in defines) {
            const r = new RegExp(`#define[^\\S]+(${argkey}\\s+)`, 'gmi');

            block = block.replaceAll(r, `#define ${argkey} ${defines[argkey]} // default:`);
        }

        return block;
    }

    resetState()
    {
        this.pixiRender.state.set(this.state3d);
    }

    resize(width : number, height : number) {
        this.size = {
            width, height
        }
        this._configure();
    }

    _configure() {

    }

    beginPass(layerPassOrOptions: any) {
        this.pixiRender.batch.flush();
        this.resetState();

        let layerPass: LayerPass;
        if (layerPassOrOptions instanceof LayerPass) {
            layerPass = layerPassOrOptions;
        } else {
            layerPass = new LayerPass(layerPassOrOptions);
        }

        this.pixiRender.pass.begin(layerPass);

        return layerPass;
    }

    endPass(layerPass?: LayerPass)
    {
        this.pixiRender.batch.flush();

        this.pixiRender.pass.end(layerPass);
    }

    /**
     * Blit one render target to another size-to-size
     * @param {BaseRenderTarget} fromTarget
     * @param {BaseRenderTarget} toTarget
     */
    blit(fromTarget = null, toTarget = null) {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    /**
     * Blit active render target to another, can be used for blitting canvas too
     * @param {BaseRenderTarget} toTarget
     */
    blitActiveTo(toTarget) {
        this.blit(this._target, toTarget);
    }

    createMaterial(options) {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    drawMesh(geom : GeometryTerrain, material : WebGLMaterial, a_pos : Vector = null, modelMatrix : imat4 = null, draw_type? : string) {
        if (geom.size === 0) {
            return;
        }
        this.batch.setObjectRenderer(this.mesh);
        this.mesh.draw(geom, material, a_pos, modelMatrix, draw_type);
    }

    drawCube(cube) {
        this.batch.setObjectRenderer(this.cube);
        this.cube.draw(cube);
    }

    createShader(options) {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    createLineShader(options) {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    /**
     *
     * @param {*} options
     * @returns {Promise<any>}
     */
    async createResourcePackShader(options): Promise<any> {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    createCubeMap(options) {
        throw new TypeError('Illegal invocation, must be overridden by subclass');
    }

    resetBefore() {
        this.pixiRender.shader.reset();
        this.pixiRender.state.reset();
        this.resetState();
    }

    resetAfter() {
        this.pixiRender.shader.reset();
        this.pixiRender.geometry.reset();
    }

    destroy() {

    }

    rtToRawPixels(rt: RenderTexture) {
        /**
         * @type {WebGL2RenderingContext}
         */
        const gl = this.gl
        const buffer = new Uint8Array(rt.width * rt.height * 4);

        this.pixiRender.renderTexture.bind(rt);
        gl.readPixels(0,0,rt.width, rt.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
        this.pixiRender.renderTexture.bind(null);

        return buffer;
    }

    async rtToImage(rt: RenderTexture, mode = 'image') {
        let buffer = this.rtToRawPixels(rt);

        if (buffer instanceof Promise) {
            buffer = await buffer;
        }

        for (let i = 0; i < buffer.length; i += 4) {
            const a = buffer[i + 3] / 0xff;

            if (!a) {
                continue;
            }

            buffer[i + 0] = Math.round(buffer[i + 0] / a);
            buffer[i + 1] = Math.round(buffer[i + 1] / a);
            buffer[i + 2] = Math.round(buffer[i + 2] / a);
        }

        const data = new ImageData(rt.width, rt.height);

        for(let i = 0; i < rt.height; i ++) {
            const invi = rt.height - i - 1;
            data.data.set(
                buffer.subarray(invi * rt.width * 4, (invi + 1) * rt.width * 4),
                i * rt.width * 4);
        }

        if (mode === 'bitmap') {
            return self.createImageBitmap(data);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.canvas.width = rt.width;
        ctx.canvas.height = rt.height;
        ctx.putImageData(data, 0, 0);

        if (mode === 'canvas') {
            return canvas;
        }

        const img = new Image(rt.width, rt.height);

        return new Promise(res => {
            img.onload = () => res(img);
            img.src = ctx.canvas.toDataURL();

            ctx.canvas.width = ctx.canvas.height = 0;

            return img;
        });
    }

    static ID = 0;
}
