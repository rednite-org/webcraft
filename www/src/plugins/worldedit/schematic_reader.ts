import { BLOCK, DBItemBlock } from "../../blocks.js";
import { Schematic } from "@server/node_modules/madcraft-schematic-reader/index.js";
import { promises as fs } from 'fs';
import { DIRECTION_BIT, ObjectHelpers, SIX_VECS, Vector, VectorCollector } from "../../helpers.js";
import { RailShape } from "../../block_type/rail_shape.js";
import * as FLUID from '../../fluid/FluidConst.js';

const facings4 = ['north', 'west', 'south', 'east'];
const facings6 = ['north', 'west', 'south', 'east', /*'up', 'down'*/];
const dripstone_stages = ['tip', 'frustum', 'middle', 'base'];
const NO_IMPORT_BLOCKS = ['NETHER_PORTAL'];

declare type IMCBlock = {
    type:              int
    name:              string
    _properties:       any
    entities:          any
    signText:          any
    on_wall:           any
}

declare type IParseBlockResult = {
    b? : IBlockMaterial,
    name? : string
}

declare type IStateBlock = {
    new_block:          IMCBlock,
    fluidValue:         int,
    b:                  IBlockMaterial,
    read_entity_props:  boolean,
}

// const {Schematic} = await import("prismarine-schematic" as any)

// SchematicReader...
export class SchematicReader {
    blocks: VectorCollector
    fluids: any[]
    entity_pos: Vector
    replaced_names: {
        [key: string]: string
    };

    constructor() {
        this.blocks = new VectorCollector();
        this.fluids = [];

        this.entity_pos = new Vector(0, 0, 0)
        this.replaced_names = {
            BARRIER:                'AIR',
            CAVE_AIR:               'AIR',
            SPAWNER:                'MOB_SPAWN',
            LAVA:                   'STILL_LAVA',
            WATER:                  'STILL_WATER',
            WHEAT:                  'WHEAT_SEEDS',
            COCOA:                  'COCOA_BEANS',
            SIGN:                   'BIRCH_SIGN',
            DETECTOR_RAIL:          'POWERED_RAIL',
            SKELETON_SKULL:         'SKULL_DESERT',
            CARROTS:                'CARROT_SEEDS',
            LAVA_CAULDRON:          'CAULDRON',
            CAVE_VINES_PLANT:       'CAVE_VINES',
            // Old version block names
            GRASS_PATH:             'DIRT_PATH',
            STONEBRICK:             'STONE_BRICKS',
            WATERLILY:              'LILY_PAD',
            SAPLING:                'OAK_SAPLING',
            LEAVES:                 'OAK_LEAVES',
            RED_FLOWER:             'RED_TULIP',
            POTATO:                 'POTATOES',
            QUARTZ:                 'QUARTZ_BLOCK',
            MAGMA:                  'MAGMA_BLOCK',
            DIAMOND_SHOVEL:         'TITANIUM_SHOVEL',
            DIAMOND_SWORD:          'TITANIUM_SWORD',
            DIAMOND_AXE:            'TITANIUM_AXE',
            DIAMOND_PICKAXE:        'TITANIUM_PICKAXE',
            WOOL:                   'WHITE_WOOL',
            LOG:                    'OAK_LOG',
            LOG2:                   'BIRCH_LOG',
            PLANKS:                 'OAK_PLANKS',
            WOODEN_SLAB:            'OAK_SLAB',
            BANNER:                 'WHITE_BANNER',
            BRICK_BLOCK:            'BRICKS',
            POTION:                 'WATER_BOTTLE',
            BOOK:                   'ENCHANTED_BOOK',
            WOODEN_BUTTON:          'OAK_BUTTON',
            FENCE:                  'OAK_FENCE',
            TRAPDOOR:               'OAK_TRAPDOOR',
            WOODEN_DOOR:            'OAK_DOOR',
            WOODEN_PRESSURE_PLATE:  'OAK_PRESSURE_PLATE',
            DYE:                    'WHITE_DYE',
            DOUBLE_PLANT:           'PEONY',
            TALLGRASS:              'TALL_GRASS',
            YELLOW_FLOWER:          'DANDELION',
            CARVED_PUMPKIN:         'LIT_PUMPKIN',
            LAPIS_ORE:              'LAPIS_LAZULI_ORE',
        }
    }

    // Read schematic file
    async read(orig_file_name : string, read_air : boolean = false) {

        orig_file_name += ''

        let file_name = `../data/schematics/${orig_file_name}`;
        console.log(file_name)

        // Check schem file exists and try extension append
        const fileExists = path => fs.stat(path).then(() => true, () => false);
        if(!await fileExists(file_name)) {
            if(!orig_file_name.includes('.')) {
                let found = false;
                for(let ext of ['schem', 'schematic', 'schema']) {
                    let next_file_name = `${file_name}.${ext}`;
                    if(await fileExists(next_file_name)) {
                        found = true;
                        file_name = next_file_name;
                        break;
                    }
                }
                if(!found) {
                    console.log(await fs.realpath('./'))
                    throw 'error_schem_file_not_found';
                }
            }
        }

        // read schematic
        const schematic : Schematic = await Schematic.read(await fs.readFile(file_name))

        // Prepare BlockEntities for fast search
        const BlockEntities = new VectorCollector();
        const bePos = new Vector(0, 0, 0);
        if(schematic.blockEntities) {
            for(let i = 0; i < schematic.blockEntities.length; i++) {
                const item = schematic.blockEntities[i];
                BlockEntities.set(bePos.set(item.Pos[0], item.Pos[1], item.Pos[2]), item);
            }
        } else {
            console.error('schematic reader not support read chests and other block entities')
        }

        let min_y = Infinity

        const not_found_blocks                  = new Map()
        const cached_blocks                     = new Map()
        const states : Map<int, IStateBlock>    = new Map()
        const bpos                              = new Vector(0, 0, 0)
        const eb_pos                            = new Vector(0, 0, 0)
        const FLOWER_POT_BLOCK_ID               = BLOCK.fromName('FLOWER_POT').id
        const AIR_BLOCK                         = new DBItemBlock(0)
        const TEST_BLOCK                        = new DBItemBlock(BLOCK.fromName('TEST').id)
        const STILL_WATER_BLOCK                 = new DBItemBlock(BLOCK.fromName('STILL_WATER').id)
        const STILL_LAVA_BLOCK                  = new DBItemBlock(BLOCK.fromName('STILL_LAVA').id)
        const result : IParseBlockResult        = {b: null, name: null};

        // each all blocks
        (schematic as any).forEachFast((block : IMCBlock, pos : IVector, stateId : int) => {
            bpos.copyFrom(pos)
            bpos.z *= -1;
            if(bpos.y < min_y) {
                min_y = bpos.y;
            }
            if(block.type === AIR_BLOCK.id) {
                this.blocks.set(bpos, AIR_BLOCK)
                return
            }
            let new_block = null
            let fluidValue = 0
            let read_entity_props = false
            const st = states.get(stateId)
            if(st) {
                new_block = st.new_block
                fluidValue = st.fluidValue
                if(st.read_entity_props) {
                    new_block = this.createBlockFromSchematic(block, st.b, schematic, BlockEntities, pos as Vector, st.read_entity_props)
                }
            } else {
                const {name, b} = this.parseBlockName(block, result)
                if(b && NO_IMPORT_BLOCKS.includes(name)) {
                    return
                }
                if(b) {
                    // speed optimization
                    if(b.is_simple_qube) {
                        new_block = cached_blocks.get(b.id)
                    }
                    if(!new_block) {
                        // read entity props
                        if(b.chest) {
                            read_entity_props = true
                        } else if(b.is_sign) {
                            read_entity_props = true
                        } else if(b.name == 'ITEM_FRAME') {
                            read_entity_props = true
                        } else if(b.name == 'LECTERN') {
                            read_entity_props = true
                        } else if(b.is_banner) {
                            read_entity_props = true
                        } else if(b.name == 'FLOWER_POT') {
                            read_entity_props = true
                        }
                        new_block = this.createBlockFromSchematic(block, b, schematic, BlockEntities, pos as Vector, read_entity_props)
                        if(!new_block) {
                            return
                        }
                        if(b.is_simple_qube) {
                            cached_blocks.set(b.id, new_block);
                        }
                    }
                } else {
                    if(name.indexOf('POTTED_') === 0) {
                        // POTTED_PINK_TULIP - ALLIUM
                        // POTTED_WITHER_ROSE - LILY OF THE VALEY
                        const in_pot_block_name = name.substring(7);
                        const in_pot_block = BLOCK.fromName(in_pot_block_name);
                        if(in_pot_block && in_pot_block.id > 0) {
                            new_block = new DBItemBlock(FLOWER_POT_BLOCK_ID, {item: new DBItemBlock(in_pot_block.id)})
                        }
                    } else if(name.indexOf('INFESTED_') === 0) {
                        // e.g. INFESTED_STONE_BRICKS
                        const name2 = name.substring(9);
                        const b2 = BLOCK.fromName(name2);
                        if(!b2.is_dummy) {
                            new_block = new DBItemBlock(b2.id, {infested: true})
                        }
                    }
                }
                // If not implemented block
                if(!new_block) {
                    not_found_blocks.set(name, (not_found_blocks.get(name) ?? 0) + 1);
                    // replace with TEST block and store original to his extra_data
                    new_block = DBItemBlock.cloneFrom(TEST_BLOCK)
                    new_block.extra_data = {n: name}
                    if(block._properties) {
                        // fast check if object not empty
                        for(let _ in block._properties) {
                            new_block.extra_data.p = block._properties;
                            break;
                        }
                    }
                }
                if (b?.is_fluid || b?.always_waterlogged || new_block.waterlogged) {
                    const lvl = new_block.extra_data?.level ?? 0;
                    if (new_block.id === STILL_WATER_BLOCK.id) {
                        fluidValue = FLUID.FLUID_WATER_ID + lvl;
                    }
                    if (new_block.id === STILL_LAVA_BLOCK.id) {
                        fluidValue = FLUID.FLUID_LAVA_ID + lvl;
                    }
                    if(b?.is_fluid) {
                        new_block = AIR_BLOCK;
                    }
                }
                states.set(stateId, {fluidValue, new_block, b, read_entity_props})
            }
            this.blocks.set(bpos, new_block)
            // Некоторые блоки могут создавать другие блоки (двери, высокие растения и прочее)
            if(new_block.emmit_blocks) {
                for(const eb of new_block.emmit_blocks) {
                    this.blocks.set(eb_pos.copyFrom(bpos).addSelf(eb.move), eb)
                }
            }
            if (fluidValue) {
                this.fluids.push(bpos.x, bpos.y, bpos.z, fluidValue);
            }
        }, read_air);
        //
        const not_found_blocks_arr = [];
        for(const [name, count] of not_found_blocks.entries()) {
            not_found_blocks_arr.push({name, count});
        }
        not_found_blocks_arr.sort(function(a, b){return b.count - a.count});
        let not_found_blocks_str = '';
        let i = 0;
        for(let item of not_found_blocks_arr) {
            not_found_blocks_str += `${++i}. ${item.name} ... ${item.count}\n`;
        }
        console.log(`min_y ... ${min_y}`);
        console.log('Not found blocks:');
        console.log(not_found_blocks_str);
        return schematic;
    }

    //
    parseBlockName(block : IMCBlock, out : IParseBlockResult) : any {
        if(block.name == 'wall_sign') {
            block.name = 'oak_wall_sign';
        }
        if(block.name == 'wall_torch') {
            block.on_wall = true;
            block.name = 'torch';
        } else if(block.name == 'redstone_wall_torch') {
            block.on_wall = true;
            block.name = 'redstone_torch';
        } else if(block.name.endsWith('_sign')) {
            block.on_wall = block.name.endsWith('_wall_sign');
            if(block.on_wall) {
                block.name = block.name.replace('_wall_', '_');
            }
        } else if(block.name.endsWith('_banner')) {
            block.on_wall = block.name.endsWith('_wall_banner');
            if(block.on_wall) {
                block.name = block.name.replace('_wall_', '_');
            }
        } else if(block.name.endsWith('anvil')) {
            block.name = 'anvil';
        }
        //
        let name = block.name.toUpperCase()
        if(name != 'AIR') {
            const rn = this.replaced_names[name]
            if(rn) {
                name = rn
            }
        }
        out.b = BLOCK[name]
        out.name = name
        return out
    }

    //
    createBlockFromSchematic(block : IMCBlock, b : IBlockMaterial, schematic : Schematic, BlockEntities : VectorCollector, pos : Vector, read_entity_props : boolean) : DBItemBlock | null {
        const props = block._properties;
        let new_block = new DBItemBlock(b.id)
        if(new_block.id == 0) {
            return new_block;
        }
        if(read_entity_props) {
            this.entity_pos.copyFrom(pos).subSelf(schematic.offset)
            block.entities = BlockEntities.get(this.entity_pos)
        }
        if(b.item || b.style_name == 'extruder' || b.style_name == 'text') {
            if(b.item && !b.tags.includes('can_set_as_block')) {
                return null
            }
        }
        if(b.chest) {
            new_block.extra_data = this.parseChestPropsExtraData(props);
        } else if(b.tags.includes('sign')) {
            new_block.extra_data = new_block.extra_data || null;
        }
        if(b.can_rotate) {
            new_block.rotate = new Vector(0, 1, 0);
        }
        //
        const setExtraData = (k : string, v : any, obj? : {[key: string]: any}) => {
            obj = obj ?? new_block
            if(!obj.extra_data) {
                obj.extra_data = {}
            }
            obj.extra_data[k] = v
        }
        // block entities
        if(block.entities) {
            if(b.chest) {
                const chest_extra_data = this.parseChestExtraData(block.entities, props);
                if(chest_extra_data) {
                    new_block.extra_data = chest_extra_data;
                }
            } else if(b.is_sign) {
                // text
                let texts = Array(4);
                let formatted_text = [];
                let text_names = ['Text1', 'Text2', 'Text3', 'Text4'];
                for(let i in text_names) {
                    const t = text_names[i];
                    if(t in block.entities) {
                        var temp;
                        try {
                            temp = JSON.parse(block.entities[t]);
                        } catch(e) {
                            temp = { text: block.entities[t] };
                        }
                        texts[i] = temp?.text || '';
                        formatted_text[i] = temp;
                    }
                }
                setExtraData('text', texts.join('\r'));
                setExtraData('formatted_text', formatted_text);
                // color
                if('Color' in block.entities) {
                    setExtraData('color', block.entities.Color);
                }
                // glowing
                if('GlowingText' in block.entities && block.entities.GlowingText) {
                    setExtraData('glowing_text', block.entities.GlowingText);
                }
            } else if(b.is_banner) {
                if('Patterns' in block.entities) {
                    setExtraData('patterns', block.entities.Color);
                }
            } else if(b.name == 'FLOWER_POT') {
                // old versions format
                let potted_block_name = block.entities.Item
                if(potted_block_name) {
                    if(potted_block_name.indexOf(':') >= 0) {
                        potted_block_name = potted_block_name.split(':')[1].toUpperCase()
                        let in_pot_block = BLOCK[potted_block_name]
                        if(!in_pot_block) {
                            let nn = this.replaced_names[potted_block_name]
                            if(nn) {
                                in_pot_block = BLOCK[nn]
                            }
                        }
                        if(in_pot_block) {
                            setExtraData('item', new DBItemBlock(in_pot_block.id))
                        }
                    }
                }
            } else if(b.name == 'LECTERN') {
                if(block.entities.Book) {
                    const ent = block.entities;
                    // console.log(JSON.stringify(ent, null, 4));
                    if('Page' in ent && 'Book' in ent) {
                        setExtraData('page', ent.Page);
                        const book = {
                            id: 'WRITTEN_BOOK',
                            count: 1,
                            pages: []
                        } as any;
                        const tag = ent.Book.tag;
                        if(tag) {
                            if('author' in tag) book.author = tag.author;
                            if('title' in tag) book.title = tag.title;
                            if('resolved' in tag) book.resolved = tag.resolved;
                            if('pages' in tag) {
                                for(let page of ent.Book.tag.pages) {
                                    book.pages.push(JSON.parse(page));
                                }
                            }
                            setExtraData('book', book);
                        }
                    }
                }
                if('Patterns' in block.entities) {
                    setExtraData('patterns', block.entities.Color);
                }
            }
            // console.log(b.name, block.entities);
        }
        // ANVIL
        if(block.name.endsWith('anvil')) {
            setExtraData('damage', 0);
            if(block.name.startsWith('chipped_')) setExtraData('damage', 1);
            if(block.name.startsWith('damaged_')) setExtraData('damage', 2);
        }
        // CAULDRON
        if(b.name == 'CAULDRON') {
            setExtraData('lava', block.name == 'lava_cauldron')
            setExtraData('snow', block.name == 'powder_snow_cauldron')
            setExtraData('water', block.name == 'water_cauldron')
            setExtraData('level', 3)
        }
        //
        if(props) {
            // button
            if(b.is_button) {
                setExtraData('powered', props?.powered ?? false)
                if(b.tags.includes('rotate_by_pos_n_12')) {
                    if('face' in props && 'facing' in props) {
                        // ceiling wall floor
                        if(props.face == 'ceiling') {
                            new_block.rotate.x = (Math.max(facings4.indexOf(props.facing), 0) + 2)  % 4
                            new_block.rotate.y = -1;
                        } else if(props.face == 'floor') {
                            new_block.rotate.x = Math.max(facings4.indexOf(props.facing), 0);
                            new_block.rotate.y = 1;
                        } else {
                            new_block.rotate = SIX_VECS[props.facing];
                        }
                    }
                }
                return new_block;
            }
            // lantern (подвешен)
            if('hanging' in props) {
                if(!new_block.rotate) {
                    new_block.rotate = new Vector(0, 0.9, 0)
                }
                new_block.rotate.y = props.hanging ? -1 : 1;
            }
            // banner
            if('rotation' in props) {
                if(!new_block.rotate) {
                    new_block.rotate = new Vector(0, 1, 0)
                }
                new_block.rotate.x = (((parseInt(props.rotation) + 8) % 16) / 16) * 4;
            }
            //
            if('open' in props) {
                setExtraData('opened', props.open);
            }
            // петли
            if('hinge' in props) {
                setExtraData('left', props.hinge == 'left');
            }
            // рельсы
            if('shape' in props) {
                const shape_id = RailShape[props.shape.toUpperCase()];
                if(shape_id !== undefined) {
                    setExtraData('shape', shape_id);
                }
            }
            // rotate
            if(new_block.rotate) {
                // wesn
                if('west' in props && 'east' in props && 'south' in props && 'north' in props) {
                    // vine
                    if(b.name == 'VINE') {
                        // _properties: { west: false, up: false, south: false, north: true, east: false }
                        new_block.rotate = new Vector(0, 0, 0);
                        for(let f of facings6) {
                            if(f in props && props[f]) {
                                new_block.rotate.x = (facings6.indexOf(f) + 2) % 4;
                            }
                        }
                    } else {
                        new_block.rotate = new Vector(0, 0, 0);
                        for(let f of facings4) {
                            if(f in props && props[f]) {
                                new_block.rotate.x = (facings4.indexOf(f) + 1) % 4;
                            }
                        }
                    }
                }
                // facing
                if('facing' in props) {
                    if(b.tags.includes('rotate_by_pos_n_6')) {
                        new_block.rotate = SIX_VECS[props.facing].clone();
                    } else if(['fence_gate'].includes(b.style_name)) {
                        setExtraData('facing', props.facing)
                        new_block.rotate.x = facings4.indexOf(props.facing) ?? 0
                        new_block.rotate.y = 1
                    } else {
                        new_block.rotate.x = Math.max(facings4.indexOf(props.facing), 0);
                        if(['stairs', 'door', 'cocoa', 'anvil'].indexOf(b.style_name) >= 0) {
                            new_block.rotate.x = (new_block.rotate.x + 2) % 4;
                        }
                        new_block.rotate.y = 0;
                    }
                }
                //
                if(props.rotation) {
                    if(b.tags.includes('rotate_x8')) {
                        new_block.rotate.x = Math.round(props.rotation / 8 * 360) % 360
                    } else if(b.tags.includes('rotate_x16')) {
                        new_block.rotate.x = Math.round(props.rotation / 16 * 360) % 360
                    } else if(b.tags.includes('rotate_sign')) {
                        new_block.rotate.x = (props.rotation / 16 * 4 + 2) % 4
                    }
                }
            }
            // bed
            if(b.style_name == 'bed') {
                if('part' in props) {
                    const is_head = props.part == 'head';
                    setExtraData('is_head', is_head);
                    new_block.rotate.x = (new_block.rotate.x + 2) % 4;
                }
            }
            // fluids
            if(b.is_fluid) {
                if('level' in props) {
                    setExtraData('level', props.level);
                }
            }
            // COCOA_BEANS | WHEAT
            if('age' in props && (b.extra_data && 'stage' in b.extra_data)) {
                setExtraData('stage', props.age);
            }
            // part: 'head', occupied: false, facing: 'north' }
            // _properties: { part: 'foot
            // slabs
            if(b.layering && b.layering.slab && 'type' in props) {
                if(props.type == 'top') {
                    setExtraData('point', {x: 0, y: 0.9, z: 0});
                } else if(props.type == 'bottom') {
                    setExtraData('point', {x: 0, y: 0.1, z: 0});
                } else if(props.type == 'double') {
                    const double_block = b.layering.full_block_name ? BLOCK.fromName(b.layering.full_block_name) : b;
                    new_block = new DBItemBlock(double_block.id)
                    if(double_block.layering) {
                        setExtraData('height', 1);
                        setExtraData('point', new Vector(0, 0, 0));
                    }
                }
            }
            // sign
            if(b.tags.includes('sign')) {
                if(block.signText) {
                    setExtraData('text', block.signText);
                }
                if(block.on_wall) {
                    new_block.rotate.y = 0;
                }
            }
            // torch
            if(b.style_name == 'torch') {
                if(block.on_wall) {
                    new_block.rotate.y = 0;
                }
            }
            // log
            if(b.tags.includes('rotate_by_pos_n') && 'axis' in props) {
                // axis: x|y|z
                switch(props.axis) {
                    case 'x': {
                        new_block.rotate = new Vector(13, 0, 0);
                        break;
                    }
                    case 'y': {
                        new_block.rotate = new Vector(0, 1, 0);
                        break;
                    }
                    case 'z': {
                        new_block.rotate = new Vector(7, 0, 0);
                        break;
                    }
                }
            }
            // candles
            if('candles' in props) {
                setExtraData('candles', parseInt(props.candles));
            }
            if('lit' in props) {
                setExtraData('lit', props.lit);
            }
            if(b.tags.includes('mushroom_block')) {
                let t = 0
                if(props.north) t |= (1 << DIRECTION_BIT.NORTH)
                if(props.south) t |= (1 << DIRECTION_BIT.SOUTH)
                if(props.west) t |= (1 << DIRECTION_BIT.WEST)
                if(props.east) t |= (1 << DIRECTION_BIT.EAST)
                if(props.up) t |= (1 << DIRECTION_BIT.UP)
                if(props.down) t |= (1 << DIRECTION_BIT.DOWN)
                setExtraData('t', t)
            }
            // bamboo
            if(b.name == 'BAMBOO') {
                switch(props?.leaves) {
                    case 'none': {
                        if('extra_data' in new_block) {
                            delete(new_block.extra_data);
                        }
                        break;
                    }
                    case 'small': {
                        setExtraData('stage', 1);
                        setExtraData('notick', true);
                        break;
                    }
                    case 'large': {
                        setExtraData('stage', 2);
                        setExtraData('notick', true);
                        break;
                    }
                }
            } else if (b.name == 'POINTED_DRIPSTONE') {
                if('vertical_direction' in props) {
                    setExtraData('dir', props.vertical_direction == 'up' ? 1 : -1);
                }
                if('thickness' in props) {
                    let index = dripstone_stages.indexOf(props.thickness);
                    if(index < 0) {
                        index = 0;
                        console.error('unexpected props.thickness', props.thickness);
                    }
                    setExtraData('stage', index);
                }
            } else if(b.name == 'CAVE_VINES') {
                // console.log(block, props)
                setExtraData('part', block.name == 'cave_vines' ? 1 : 0)
                setExtraData('ripe', !!props.berries)
            } else if(b.name == 'LIGHT') {
                setExtraData('level', props.level | 0)
            }
            if('waterlogged' in props && props.waterlogged) {
                new_block.waterlogged = props.waterlogged;
            }
            // trapdoors and doors
            // top|bottom|lower|upper
            if('half' in props) {
                const has_point = !!b.extra_data?.point
                switch(props.half) {
                    case 'top': {
                        setExtraData('point', {x: 0, y: 0.9, z: 0})
                        break
                    }
                    case 'lower':
                    case 'bottom': {
                        if(b.has_head) {
                            if(has_point) {
                                setExtraData('point', {x: 0, y: 0.1, z: 0})
                            }
                            new_block.emmit_blocks = []
                            const eb = ObjectHelpers.deepClone(new_block)
                            setExtraData('is_head', true, eb)
                            eb.move = b.has_head.pos
                            new_block.emmit_blocks = [eb]
                        } else {
                            setExtraData('point', {x: 0, y: 0.1, z: 0});
                        }
                        break
                    }
                    case 'upper': {
                        if(b.has_head) {
                            return null
                        } else if(has_point) {
                            setExtraData('point', {x: 0, y: 0.9, z: 0});
                        }
                        break
                    }
                }
            }
        }
        return new_block
    }

    parseChestPropsExtraData(props) {
        const res = { can_destroy: true, slots: {} } as any
        if (props.type) {
            if(['left', 'right'].includes(props.type)) {
                res.type = props.type
            }
        }
        return res
    }

    parseChestExtraData(entities, props) {
        if(!entities || !entities.Items) {
            return null;
        }
        const chest_extra_data = this.parseChestPropsExtraData(props);
        for(let i = 0; i < entities.Items.length; i++)  {
            const item = entities.Items[i];
            let chest_item_name = item.id.split(':').pop();
            if(chest_item_name) {
                const slot_index = item.Slot;
                chest_item_name = chest_item_name.toUpperCase();
                let chest_item_block = BLOCK[chest_item_name]
                if(!chest_item_block) {
                    if(chest_item_name in this.replaced_names) {
                        chest_item_name = this.replaced_names[chest_item_name]
                    }
                    chest_item_block = BLOCK.fromName(chest_item_name)
                }
                if(!chest_item_block.is_dummy) {
                    const count = item.Count;
                    if(count > 0) {
                        const tag = item.tag ?? null;
                        const chest_slot = BLOCK.convertItemToDBItem(chest_item_block);
                        chest_slot.count = count;
                        if(tag) {
                            chest_slot.tag = tag;
                        }
                        chest_extra_data.slots[slot_index] = chest_slot;
                    }
                } else {
                    const chest_slot = BLOCK.convertItemToDBItem(BLOCK.fromName('TEST'));
                    chest_slot.count = item.Count ?? 1;
                    chest_slot.extra_data = {chest_slot: item};
                    chest_extra_data.slots[slot_index] = chest_slot;
                }
            }
        }
        return chest_extra_data;
    }

}