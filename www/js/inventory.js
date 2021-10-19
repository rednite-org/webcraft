import {BLOCK} from "./blocks.js";
import {CraftTable, InventoryWindow, ChestWindow, CreativeInventoryWindow} from "./window/index.js";
import {Vector, Helpers} from "./helpers.js";

// Player inventory

export default class Inventory {
    
    constructor(player, hud) {
        let that            = this;
        this.player         = player;
        this.hud            = hud;
        this.current        = null;
        this.index          = 0;
        this.max_count      = 36;
        this.hotbar_count   = 9;
        this.items          = []; // new Array(this.max_count);
        for(let i = 0; i < this.max_count; i++) {
            this.items.push(null);
        }
        //
        this.restoreItems(Game.world.saved_state.inventory);
        this.select(Game.world.saved_state.inventory.current.index);
        // set inventory to user
        this.player.setInventory(this);
        //
        let image = new Image(); // new Image(40, 40); // Размер изображения
        image.onload = function() {
            that.inventory_image = image;
            that.hud.add(that, 0);
        }
        image.src = './media/inventory2.png';
        // CraftTable
        this.ct = new CraftTable(10, 10, 352, 332, 'frmCraft', null, null, this);
        hud.wm.add(this.ct);
        // Inventory window
        this.frmInventory = new InventoryWindow(10, 10, 352, 332, 'frmInventory', null, null, this);
        hud.wm.add(this.frmInventory);
        // Creative Inventory window
        this.frmCreativeInventory = new CreativeInventoryWindow(10, 10, 390, 416, 'frmCreativeInventory', null, null, this);
        hud.wm.add(this.frmCreativeInventory);
        // Chest window
        this.frmChest = new ChestWindow(10, 10, 352, 332, 'frmChest', null, null, this);
        hud.wm.add(this.frmChest);
    }

    //
    exportItems() {
        let resp = {
            current: {
                index: this.index
            },
            items: []
        }
        for(var item of this.items) {
            let t = null;
            if(item) {
                t = {
                    id:         item.id,
                    count:      item.count,
                    power:      item.power
                };
                // Individual properties
                for(let prop of ['entity_id', 'entity_name']) {
                    t[prop] = null;
                    if(item.hasOwnProperty(prop)) {
                        t.entity_id = item[prop];
                    }
                }
            }
            resp.items.push(t);
        }
        return resp;
    }

    //
    restoreItems(saved_inventory) {
        let items = saved_inventory.items;
        this.items = []; // new Array(this.max_count);
        for(let i = 0; i < this.max_count; i++) {
            this.items.push(null);
        }
        this.index = 0;
        for(let k in items) {
            if(k >= this.items.length) {
                console.error('Limit reach of inventory');
                break;
            }
            let item = items[k];
            if(item) {
                const block = {...BLOCK.fromId(item.id)};
                if(block) {
                    item = Object.assign(block, items[k]);
                    if(!item.count) {
                        item.count = 1;
                    }
                    this.items[k] = item;
                }
            }
        }
    }
    
    getCurrent() {
        return this.current;
    }

    // Refresh
    refresh(changed) {
        if(changed) {
            console.log(changed);
        }
        // debugger;
        Game.world.server.SaveInventory(this.exportItems());
        this.hud.refresh();
    }
    
    increment(mat) {
        if(!mat.id) {
            throw 'Empty mat ID';
        }
        let block = BLOCK.BLOCK_BY_ID[mat.id];
        if(!block) {
            throw 'Invalid mat ID';
        }
        // Restore material default properties
        mat = Object.assign({
            count:              1,
            name:               block.name,
            inventory_icon_id:  block.inventory_icon_id,
            max_in_stack:       block.max_in_stack,
        }, mat);
        let item_max_count = mat.max_in_stack;
        // Update cell if exists
        for(let i in this.items) {
            let item = this.items[i];
            if(item) {
                if(item.id == mat.id) {
                    if(Game.world.game_mode.isCreative()) {
                        return;
                    }
                    if(item.count < item_max_count) {
                        if(item.count + mat.count <= item_max_count) {
                            item.count = Math.min(item.count + mat.count, item_max_count);
                            this.refresh(true);
                            return;
                        } else {
                            let remains = (item.count + mat.count) - item_max_count;
                            item.count = item_max_count;
                            mat.count = remains;
                            this.refresh(true);
                        }
                    }
                }
            }
        }
        // Start new slot
        for(let i = 0; i < this.items.length; i++) {
            if(!this.items[i]) {
                this.items[i] = {...mat};
                if(this.items[i].count > item_max_count) {
                    mat.count -= item_max_count;
                    this.items[i].count = item_max_count;
                } else {
                    mat.count = 0;
                }
                delete(this.items[i].texture);
                if(i == this.index) {
                    this.select(i);
                }
                if(mat.count > 0) {
                    this.increment(mat);
                }
                this.refresh(true);
                return;
            }
        }
    }
    
    // Decrement
    decrement() {
        if(!this.current || Game.world.game_mode.isCreative()) {
            return;
        }
        this.current.count = Math.max(this.current.count - 1, 0);
        if(this.current.count < 1) {
            this.current = this.player.buildMaterial = this.items[this.index] = null;
        }
        this.refresh(true);
    }
    
    //
    setItem(index, item) {
        this.items[index] = item;
        // Обновить текущий инструмент у игрока
        this.select(this.index);
    }
    
    //
    select(index) {
        if(index < 0) {
            index = this.hotbar_count - 1;
        }
        if(index >= this.hotbar_count) {
            index = 0;
        }
        this.index = index;
        this.current = this.player.buildMaterial = this.items[index];
        this.refresh(false);
        this.player.onInventorySelect(this.current);
    }
    
    next() {
        this.select(++this.index);
    }
    
    prev() {
        this.select(--this.index);
    }
    
    // Клонирование материала в инвентарь
    cloneMaterial(mat) {
        if(!Game.world.game_mode.isCreative()) {
            return false;
        }
        const MAX = mat.max_in_stack;
        // Search same material with count < max
        for(let k in Object.keys(this.items)) {
            if(parseInt(k) >= this.hotbar_count) {
                break;
            }
            if(this.items[k]) {
                let item = this.items[k];
                if(item.id == mat.id) {
                    this.select(parseInt(k));
                    return this.refresh(false);
                }
            }
        }
        // Create in current cell if this empty
        if(this.index < this.hotbar_count) {
            let k = this.index;
            if(!this.items[k]) {
                this.items[k] = Object.assign({count: 1}, mat);
                delete(this.items[k].texture);
                this.select(parseInt(k));
                return this.refresh(true);
            }
        }
        // Start new cell
        for(let k in Object.keys(this.items)) {
            if(parseInt(k) >= this.hotbar_count) {
                break;
            }
            if(!this.items[k]) {
                this.items[k] = Object.assign({count: 1}, mat);
                delete(this.items[k].texture);
                this.select(parseInt(k));
                return this.refresh(true);
            }
        }
        // Replace current cell
        if(this.index < this.hotbar_count) {
            let k = this.index;
            this.items[k] = Object.assign({count: 1}, mat);
            delete(this.items[k].texture);
            this.select(parseInt(k));
            return this.refresh(true);
        }
    }
    
    drawHUD(hud) {
        if(!this.index) {
            this.index = 0;
        }
        hud.wm.center(this.ct);
        hud.wm.center(this.frmInventory);
        hud.wm.center(this.frmCreativeInventory);
    }
    
    drawHotbar(hud, cell_size, pos) {
        if(!this.inventory_image) {
            return;
        }
        hud.ctx.imageSmoothingEnabled = false;
        // 1. that.inventory_image
        // 2. inventory_selector
        // img,sx,sy,swidth,sheight,x,y,width,height
        const hud_pos = new Vector(pos.x, pos.y, 0);
        // style
        hud.ctx.font            = '18px Minecraftia';
        hud.ctx.textAlign       = 'right';
        hud.ctx.textBaseline    = 'bottom';
        for(const k in this.items) {
            const item = this.items[k];
            if(k >= this.hotbar_count) {
                break;
            }
            if(item) {
                if(!item.name) {
                    console.error(item);
                }
                if('inventory_icon_id' in item) {
                    let icon = BLOCK.getInventoryIconPos(item.inventory_icon_id);
                    hud.ctx.drawImage(
                        this.inventory_image,
                        icon.x,
                        icon.y,
                        icon.width,
                        icon.height,
                        hud_pos.x + cell_size / 2 - icon.width / 2 - 4,
                        hud_pos.y + cell_size / 2 - icon.height / 2,
                        48,
                        48
                    );
                } else {
                    hud.ctx.textBaseline    = 'top';
                    hud.ctx.font            = '12px Minecraftia';
                    let text = item.name.substring(0, 4);
                    hud.ctx.fillStyle = '#000000ff';
                    hud.ctx.fillText(text, hud_pos.x + cell_size - 5, hud_pos.y + 20);
                    hud.ctx.fillStyle = '#ffffffff';
                    hud.ctx.fillText(text, hud_pos.x + cell_size - 5, hud_pos.y + 20 - 2);
                }
                if(item.count > 1) {
                    hud.ctx.textBaseline    = 'bottom';
                    hud.ctx.font            = '18px Minecraftia';
                    hud.ctx.fillStyle = '#000000ff';
                    hud.ctx.fillText(item.count, hud_pos.x + cell_size - 5, hud_pos.y + cell_size);
                    hud.ctx.fillStyle = '#ffffffff';
                    hud.ctx.fillText(item.count, hud_pos.x + cell_size - 5, hud_pos.y + cell_size - 2);
                }
                // Draw instrument life
                if(item.instrument_id && item.power < 1) {
                    let cx = hud_pos.x + 14;
                    let cy = hud_pos.y + 14;
                    let cw = 40;
                    let ch = 43;
                    hud.ctx.fillStyle = '#000000ff';
                    hud.ctx.fillRect(cx, cy + ch - 8, cw, 8);
                    //
                    let rgb = Helpers.getColorForPercentage(item.power);
                    hud.ctx.fillStyle = rgb.toCSS();
                    hud.ctx.fillRect(cx, cy + ch - 8, cw * item.power | 0, 4);
                }
            }
            hud_pos.x += cell_size;
        }
    }

}