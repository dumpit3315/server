const express = require('express');
const app = express();
app.use(express.json())

const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {path: "/dumpit_remote/", transports: ["websocket"], connectionStateRecovery: {maxDisconnectionDuration: 90000}, pingTimeout: 30000, pingInterval: 5000});
const crypto = require("crypto");
const AnalyticsModel = require("./dbAnalyticsModel")

const knex = require("knex");
const kDB = knex.knex(require("./dbConst"))

const objection = require("objection")
objection.Model.knex(kDB)

/* -1- Dumpit Forward */

var token_map = {}

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
    socket.emit("protocol", "dumpit")

    socket.on('forward_request', (cb) => {        
      const token = doGenerateString(6);
      socket.data.token = token;    
      socket.data.is_forward_pin = true;

      token_map[token] = socket;
      
      socket.removeAllListeners('forward_request')
      socket.removeAllListeners('forward_connect')
      return cb({error: null, token: token});    
    });

    socket.on('forward_connect', (token, cb) => {
      if (!token) return cb({error: "You must specify for an instance code."});
      if (token_map[token] === undefined) return cb({error: "Instance code invalid"});    

      const room_id = crypto.randomBytes(16).toString("hex");

      token_map[token].emit("forward_client_connected");
      token_map[token].join(`di-session-${room_id}`);    
      
      token_map[token].data.cur_room = `di-session-${room_id}`;
      token_map[token].data.is_forward_server = true;
      token_map[token].data.is_forward_pin = false;

      socket.data.token = token;
      socket.join(`di-session-${room_id}`);

      socket.data.cur_room = `di-session-${room_id}`;
      socket.data.is_forward_server = false;
      socket.data.is_forward_pin = false;

      delete token_map[token];

      socket.removeAllListeners('forward_request')
      socket.removeAllListeners('forward_connect')
      return cb({error: null});    
    })
  } else if (socket.recovered && socket.data.is_forward_pin) {
    token_map[socket.data.token] = socket;
  }

  socket.on('disconnect', (r) => {  
    if (r === "client namespace disconnect") {      
        if (token_map[socket.data.token] !== undefined) delete token_map[socket.data.token];
        if (socket.data.cur_room !== undefined) io.to(socket.data.cur_room).disconnectSockets(true);
    } else if (r === "server shutting down") {
        io.disconnectSockets(true);
    }
  });

  socket.on("data", (data) => {
    socket.broadcast.emit("data", data);
  })
  
  socket.on("command", (data) => {
    socket.broadcast.emit("data", data);
  })

  socket.on("log", (data) => {
    if (socket.data.is_forward_server) socket.broadcast.emit("log", data);
  })

  socket.on("bye", (data) => {
    if (token_map[socket.data.token] !== undefined) delete token_map[socket.data.token];
    if (socket.data.cur_room !== undefined) io.to(socket.data.cur_room).disconnectSockets(true);

    socket.disconnect(true);
  })
});

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