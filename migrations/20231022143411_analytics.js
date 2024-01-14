/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema
    .createTable('analytics', (table) => {
      table.increments('id').primary()

      table.string("user_id").notNullable()
      table.string("action").notNullable()
      table.string("dumpit_version").notNullable()
      table.string("python_version").notNullable()
      table.string("openocd_version").notNullable()      

      table.string("os").notNullable()            
      table.json("config").notNullable()

      table.json("params")
      
      table.date("date").notNullable()          
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
    .dropTableIfExists('analytics')
};