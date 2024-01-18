const express = require('express');
const app = express();
const path = require('path');

app.use(express.json())

const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {path: "/dumpit_remote/", transports: ["websocket"], connectionStateRecovery: {maxDisconnectionDuration: 90000}, pingTimeout: 30000, pingInterval: 5000});
const crypto = require("crypto");
const AnalyticsModel = require("./dbAnalyticsModel")
const sioAdmin = require("@socket.io/admin-ui")
const bcryptjs = require("bcryptjs")
app.set("view engine", "ejs")

const knex = require("knex");
const kDB = knex.knex(require("./dbConst"))

const objection = require("objection")
objection.Model.knex(kDB)

/* -1- Dumpit Forward */

var token_map = {}
var reconnect_map = {}
var rooms = []
var rooms_info_map = {}
var rooms_count_buffer = {}

setInterval(async () => {  
  try {
    for (const room of rooms) {
      const connected_sockets = await io.to(room).fetchSockets();

      if (rooms_count_buffer[room] === connected_sockets.length) {
        if (rooms_count_buffer[room] <= 1) {
          io.to(room).emit("bye");
          io.timeout(1500).to(room).disconnectSockets(true);                    

          const room_index = rooms.indexOf(room);
          if (room_index !== -1) {
            rooms.splice(room, 1);
          }

          if (reconnect_map[rooms_info_map[room].reconnect_forward] !== undefined) delete reconnect_map[rooms_info_map[room].reconnect_forward];
          if (reconnect_map[rooms_info_map[room].reconnect_client] !== undefined) delete reconnect_map[rooms_info_map[room].reconnect_client];

          if (rooms_info_map[room] !== undefined) delete rooms_info_map[room];
          if (rooms_count_buffer[room] !== undefined) delete rooms_count_buffer[room];
        }
      } else {
        rooms_count_buffer[room] = connected_sockets.length;
      }
    }
  } catch (e) {
    console.trace(e);
  }
}, 5000)

const characters ='abcdefghijklmnopqrstuvwxyz0123456789';

function doGenerateString(length) {
    let result = '';
    const charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }

    return result;
}

io.on('connection', (socket) => {  
  if (!socket.recovered || !socket.data.cur_room) {        
    socket.emit("protocol", "dumpit");

    socket.on('forward_request', (cb) => {        
      const token = doGenerateString(6);
      socket.data.token = token;    
      socket.data.is_forward_pin = true;

      token_map[token] = socket;
      
      socket.removeAllListeners('forward_request');
      socket.removeAllListeners('forward_connect');
      socket.removeAllListeners('forward_reconect');
      return cb({error: null, token: token});    
    });

    socket.on('forward_connect', (token, cb) => {
      if (!token) return cb({error: "You must specify for an instance code."});
      if (token_map[token] === undefined) return cb({error: "The instance code you have entered is not valid."});    

      const room_id = crypto.randomBytes(16).toString("hex");  

      /* 1 - Process connect client */
      const reconnect_token = crypto.randomBytes(16).toString("hex");
      reconnect_map[reconnect_token] = {forward: false, room_id: room_id, room_token: token};
      
      socket.removeAllListeners('forward_request');
      socket.removeAllListeners('forward_connect');
      socket.removeAllListeners('forward_reconnect');

      socket.data.token = token;
      socket.join(`di-session-${room_id}`);      

      socket.data.cur_room = `di-session-${room_id}`;
      socket.data.is_forward_server = false;
      socket.data.is_forward_pin = false;
      socket.data.reconnect_token = reconnect_token;   

      cb({error: null, reconnect_token: reconnect_token});
      
      /* 2 - Process connect server */
      const reconnect_token_forward = crypto.randomBytes(16).toString("hex");
      reconnect_map[reconnect_token_forward] = {forward: true, room_id: room_id, room_token: token};
      
      token_map[token].join(`di-session-${room_id}`);    
      
      token_map[token].data.cur_room = `di-session-${room_id}`;
      token_map[token].data.is_forward_server = true;
      token_map[token].data.is_forward_pin = false;      
      token_map[token].data.reconnect_token = reconnect_token_forward;

      token_map[token].emit("forward_client_connected", {reconnect_token: reconnect_token_forward});

      rooms.push(`di-session-${room_id}`);
      rooms_info_map[`di-session-${room_id}`] = {client: socket, forward: token_map[token], reconnect_forward: reconnect_token_forward, reconnect_client: reconnect_token};

      delete token_map[token];      
    })

    socket.on('forward_reconnect', (token, cb) => {
      if (reconnect_map[token] === undefined) return cb({error: "Invalid reconnect token"});

      const reconnect_token = crypto.randomBytes(16).toString("hex");
      reconnect_map[reconnect_token] = reconnect_map[token];

      delete reconnect_map[token];      

      if (reconnect_map[reconnect_token].forward) {
        rooms_info_map[`di-session-${reconnect_map[reconnect_token].room_id}`].forward = socket;
        rooms_info_map[`di-session-${reconnect_map[reconnect_token].room_id}`].reconnect_forward = reconnect_token;
      } else {
        rooms_info_map[`di-session-${reconnect_map[reconnect_token].room_id}`].client = socket;
        rooms_info_map[`di-session-${reconnect_map[reconnect_token].room_id}`].reconnect_client = reconnect_token;
      }

      socket.removeAllListeners('forward_request');
      socket.removeAllListeners('forward_connect');
      socket.removeAllListeners('forward_reconect');

      socket.data.token = reconnect_map[reconnect_token].room_token;
      socket.join(`di-session-${reconnect_map[reconnect_token].room_id}`);

      socket.data.cur_room = `di-session-${reconnect_map[reconnect_token].room_id}`;
      socket.data.is_forward_server = reconnect_map[reconnect_token].forward;      
      socket.data.is_forward_pin = false;
      socket.data.reconnect_token = reconnect_token;       

      cb({error: null, reconnect_token: reconnect_token});
    })
  } else if (socket.recovered && socket.data.is_forward_pin) {
    socket.timeout(1000).emit("protocol", "dumpit");
    token_map[socket.data.token] = socket;
  } else if (socket.recovered && !socket.data.is_forward_pin) {
    socket.timeout(1000).emit("protocol", "dumpit");
    if (socket.data.is_forward_server) {
      rooms_info_map[socket.data.cur_room].forward = socket;        
    } else {
      rooms_info_map[socket.data.cur_room].client = socket;        
    }

    socket.on('forward_reconnect', (token, cb) => {               
      socket.removeAllListeners('forward_reconect');          
      cb({error: null, reconnect_token: socket.data.reconnect_token});
    })
  }
  
  socket.on('disconnect', (r) => {  
    if (r === "client namespace disconnect") {      
        if (token_map[socket.data.token] !== undefined) delete token_map[socket.data.token];                
    } else if (r === "server shutting down") {
        io.send("bye");
        io.disconnectSockets(true);
    }
  });

  socket.on("data", (data) => {
    socket.broadcast.emit("data", data);
  })
  
  socket.on("command", (data) => {
    socket.broadcast.emit("data", data);
  })

  socket.on("log_req", (data) => {
    if (socket.data.is_forward_server) {
      socket.broadcast.emit("log", data.data);
      socket.emit("log_ack", data.id);
    }
  })

  socket.on("bye", (data, cb) => {
    if (token_map[socket.data.token] !== undefined) delete token_map[socket.data.token];

    socket.broadcast.emit("bye");        
    socket.leave(socket.data.cur_room);

    if (cb) cb();
  })

  socket.on("ping", (data) => {
    socket.emit("pong");
  })

  socket.on("ping_remote", (data) => {
    socket.broadcast.emit("ping_remote");
  })

  socket.on("pong_remote", (data) => {
    socket.broadcast.emit("pong_remote");
  })
});

const admin_randpass = crypto.randomBytes(16).toString("hex");
const admin_randuser = crypto.randomBytes(16).toString("hex");

sioAdmin.instrument(io, {
  auth: {
    type: "basic",
    username: admin_randuser,
    password: bcryptjs.hashSync(admin_randpass)
  },
  mode: "development"
})

app.get('/sio_admin', (req, res, next) => {
  if (req.hostname !== "localhost") return next();
  res.render("admin", {rand_user: admin_randuser, rand_pass: admin_randpass})
})

app.use('/sio_admin', (req, res, next) => {
  if (req.hostname !== "localhost") return next();
  return express.static('sio_admin')(req, res)
})

app.use('/sio/info', (req, res, next) => {
  if (req.hostname !== "localhost") return next();
  console.trace({token_map, reconnect_map, rooms, rooms_info_map, rooms_count_buffer});
  res.json({reconnect_map, rooms, rooms_count_buffer});
})

/* -2- Dumpit Analytics */

app.get('/', (req, res) => {
  res.redirect(301, "https://github.com/dumpit3315/server")
});

app.get('/analytics/statistics', async (req, res,  next) => {
  if (req.hostname !== "localhost") return next();

  res.sendFile(path.resolve(path.join(__dirname,"/res/analytics.html")));
})

app.post('/analytics/get', async (req, res,  next) => {  
  if (req.hostname !== "localhost") return next();

  if (req.body.user_id === undefined) {
    _res = await AnalyticsModel.query();
    res.json(_res);
  } else {
    _res = await AnalyticsModel.query().where("user_id", "=", req.body.userid);
    res.json(_res);
  }
})

app.post('/analytics/clear', async (req, res,  next) => {  
  if (req.hostname !== "localhost") return next();

  await AnalyticsModel.query().delete()
  res.end()
})

app.post("/analytics/track", async (req, res) => {
  if (req.body.user_id === undefined) return res.status(400).json({error: "I don't know which user i'm going to track for."})
  if (req.body.os === undefined || req.body.dumpit_version === undefined || req.body.python_version === undefined || req.body.openocd_version === undefined || req.body.config === undefined) return res.status(400).json({error: "I don't have enough data to collect for this user."})

  switch (req.body.action) {
    case "idcode":
      if (req.body.idcode === undefined) return res.status(400).json({error: "I need an IDCODE."})
      
      await AnalyticsModel.query().insert({
        user_id: req.body.user_id,
        action: req.body.action,
        dumpit_version: req.body.dumpit_version,
        python_version: req.body.python_version,
        openocd_version: req.body.openocd_version,
        os: req.body.os,
        config: req.body.config,
        params: {
          idcode: parseInt(req.body.idcode)
        },
        date: Date.now()
      })

      break;

    case "nand_idcode":
      if (req.body.manufacturer === undefined || req.body.device === undefined || req.body.ext_id1 === undefined || req.body.ext_id2 === undefined) return res.status(400).json({error: "I need manufacturer ID, device ID, and 2 of those extension IDs."})
      
      await AnalyticsModel.query().insert({
        user_id: req.body.user_id,
        action: req.body.action,
        dumpit_version: req.body.dumpit_version,
        python_version: req.body.python_version,
        openocd_version: req.body.openocd_version,
        os: req.body.os,
        config: req.body.config,
        params: {
          manufacturer: req.body.manufacturer,
          device: req.body.device,
          ext_id: req.body.ext_id1 << 16 | req.body.ext_id2
        },
        date: Date.now()
      })
      
      break;    

    case "dump_start":          
    case "dump_end":      
        if (req.body.addr_start === undefined || req.body.addr_end === undefined || req.body.is_memory === undefined) return res.status(400).json({error: "I need those address ranges and also determine whether you\'re performing a memory dump."})

        await AnalyticsModel.query().insert({
          user_id: req.body.user_id,
          action: req.body.action,
          dumpit_version: req.body.dumpit_version,
          python_version: req.body.python_version,
          openocd_version: req.body.openocd_version,
          os: req.body.os,
          config: req.body.config,
          params: {
            start: req.body.addr_start,
            end: req.body.addr_end,
            is_memdump: req.body.is_memory
          },
          date: Date.now()
        })
        
        break;

    case "error":
        if (req.body.error === undefined || req.body.traceback === undefined) return res.status(400).json({error: "I need an error message and a traceback."})

        await AnalyticsModel.query().insert({
          user_id: req.body.user_id,
          action: req.body.action,
          dumpit_version: req.body.dumpit_version,
          python_version: req.body.python_version,
          openocd_version: req.body.openocd_version,
          os: req.body.os,
          config: req.body.config,
          params: {
            error: req.body.error,
            traceback: req.body.traceback
          },
          date: Date.now()
        })
        
        break;

    case "connect":
        if (req.body.type === undefined) return res.status(400).json({error: "I need you to specify the type of connection."})

        await AnalyticsModel.query().insert({
          user_id: req.body.user_id,
          action: req.body.action,
          dumpit_version: req.body.dumpit_version,
          python_version: req.body.python_version,
          openocd_version: req.body.openocd_version,
          os: req.body.os,
          config: req.body.config,
          params: {
            type: req.body.type
          },
          date: Date.now()
        })
        
        break;

    case "disconnect":
        if (req.body.reason === undefined) return res.status(400).json({error: "I need you to provide a reason for the disconnection."})

        await AnalyticsModel.query().insert({
          user_id: req.body.user_id,
          action: req.body.action,
          dumpit_version: req.body.dumpit_version,
          python_version: req.body.python_version,
          openocd_version: req.body.openocd_version,
          os: req.body.os,
          config: req.body.config,
          params: {
            reason: req.body.reason
          },
          date: Date.now()
        })
        
        break;

    default:
      return res.status(400).json({error: "I don't know which data i would collect."})
  }

  res.status(204).end()
})

/* -3- Listening */

const port = process.env.PORT ? process.env.PORT : 8152

server.listen(port, () => {
  console.log(`Start dumpit forward server at ${port}`);
});