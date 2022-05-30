import { ServerClient } from "../../../www/js/server_client.js";

export default class packet_reader {

    // must be puto to queue
    static get queue() {
        return false;
    }

    // which command can be parsed with this class
    static get command() {
        return ServerClient.CMD_PICKAT_ACTION;
    }

    // Pickat action
    static async read(player, packet) {
		if(packet.data.destroyBlock == true) {
			player.state.stats.pickat++;
		}
        player.world.pickAtAction(player, packet.data);
    }

}