import socketio
import time

sio = socketio.SimpleClient()


sio.connect(f"http://localhost:8152/", transports=["websocket"], socketio_path="dumpit_remote")
p = sio.receive()
print("wait protocol")

if p[0] != "protocol" or p[1] != "dumpit": raise Exception("Not a valid Dumpit remote protocol.")

print("call token")

token = sio.call("forward_request")
print("token", token["token"])

while True:
    p = sio.receive()
    if p[0] == "forward_client_connected": break
        
while True:
    print("do send data 1")
    sio.emit("data", "12345678")
    time.sleep(2)
    print("do receive data 1")
    print(sio.receive())
    time.sleep(2)