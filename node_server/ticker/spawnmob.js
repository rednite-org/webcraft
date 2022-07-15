import {Vector} from "../../www/js/helpers.js";
import {BLOCK} from "../../www/js/blocks.js";
import {ServerClient} from "../../www/js/server_client.js";

const SPAWN_PLAYER_DISTANCE     = 16;
const SPAWN_RAD_HOR             = 4;
const SPAWN_RAD_VERT            = 2;
const SPAWN_ATTEMPTS            = 4;

export default class Ticker {

    static type = 'spawnmob'

    //
    static async func(world, chunk, v) {

        const tblock = v.tblock;
        const ticking = v.ticking;
        const extra_data = tblock.extra_data;
        const updated_blocks = [];

        if(v.ticks % extra_data.max_ticks == 0) {

            const pos = v.pos.clone();

            // Одноразовый спавнер
            if (extra_data?.limit?.count === 1) {
                const spawn_pos = pos.add(new Vector(.5, 0, .5));
                const params = {
                    type           : extra_data.type,
                    skin           : extra_data.skin,
                    pos            : spawn_pos,
                    pos_spawn      : spawn_pos.clone(),
                    rotate         : new Vector(0, 0, 0).toAngles()
                };
                // Spawn mob
                await world.mobs.create(params); 
                const updated_blocks = [];
                updated_blocks.push({pos: pos.clone(), item: {id: BLOCK.AIR.id}, action_id: ServerClient.BLOCK_ACTION_MODIFY});
                console.log('One spawn mob', pos.toHash());
                // Delete completed block from tickings
                this.delete(v.pos);
                return updated_blocks;
            }

            // Проверяем наличие игроков в указанном радиусе
            const players = world.getPlayersNear(pos, SPAWN_PLAYER_DISTANCE, false, true);
            if (players.length == 0) {
                return;
            }

            // Спаунер перестает создавать мобов, если в зоне размером 17x9x17 находятся шесть или более мобов одного типа.
            // Проверяем количество мобов в радиусе(в радиусе 4 блоков не должно быть больше 5 мобов)
            const mobs = world.getMobsNear(pos, 9);
            if (mobs.length > 5) {
                console.warn('mobs.length >= 6');
                return;
            }

            // Место спауна моба, 4 попытки. Если на координатак моб, игрок или блок, то не спауним
            let spawned_count = 0;
            for(let i = 0; i < SPAWN_ATTEMPTS; i++) {
                const x = Math.floor(Math.random() * (SPAWN_RAD_HOR * 2 + 1) + -SPAWN_RAD_HOR);
                const z = Math.floor(Math.random() * (SPAWN_RAD_HOR * 2 + 1) + -SPAWN_RAD_HOR);
                const y = Math.random() * SPAWN_RAD_VERT | 0;
                const spawn_pos = pos.add(new Vector(x, y, z)).flooredSelf();
                let spawn_disabled = false;
                //
                for(let player of players) { 
                    const check_pos = player.state.pos.floored();
                    if (check_pos.x == spawn_pos.x && check_pos.z == spawn_pos.z) {
                        spawn_disabled = true;
                        break;
                    }
                }
                if(!spawn_disabled) {
                    // check mobs
                    for(let mob of mobs) {
                        const check_pos = mob.pos.floored();
                        if (check_pos.x == spawn_pos.x && check_pos.z == spawn_pos.z) {
                            spawn_disabled = true;
                            break;
                        }
                    }
                    // Проверяем есть ли блок на пути и что под ногами для нейтральных мобов
                    const body = world.getBlock(spawn_pos);
                    const legs = world.getBlock(spawn_pos.sub(Vector.YP));
                    if (body.id != 0) {
                        spawn_disabled = true;
                    }
                    if(!spawn_disabled) {
                        const params = {
                            type:       extra_data.type,
                            skin:       extra_data.skin,
                            pos:        spawn_pos,
                            pos_spawn:  spawn_pos.clone(),
                            rotate:     new Vector(0, 0, 0).toAngles()
                        };
                        console.log('Spawn mob', pos.toHash());
                        await world.mobs.create(params);
                        spawned_count++;
                    }
                }
            }
            //
            if(spawned_count > 0) {
                // между попытками создания мобов спаунер ждёт случайно выбранный промежуток времени от 200 до 799
                extra_data.max_ticks = Math.random() * 600 | 0 + 200;
                updated_blocks.push({pos: v.pos.clone(), item: {id: tblock.id, extra_data: extra_data}, action_id: ServerClient.BLOCK_ACTION_MODIFY});
                return updated_blocks;
            }
        }
    }

}