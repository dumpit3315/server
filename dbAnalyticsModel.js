const {Model} = require("objection");

class Analytics extends Model {
    static get tableName() {
        return 'analytics';
    }    
}

module.exports = Analytics