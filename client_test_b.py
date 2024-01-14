import socketio
import time
import sys

sio = socketio.SimpleClient()


sio.connect(f"http://localhost:8152/", transports=["websocket"], socketio_path="dumpit_remote")
p = sio.receive()
print("wait protocol")

if p[0] != "protocol" or p[1] != "dumpit": raise Exception("Not a valid Dumpit remote protocol.")

print("call token")

res = sio.call("forward_connect", sys.argv[1])
assert res["error"] == None

while True:
    print("do receive data 2")
    print(sio.receive())
    time.sleep(2)
    print("do send data 2")
    sio.emit("data", "12345678")
    time.sleep(2)
