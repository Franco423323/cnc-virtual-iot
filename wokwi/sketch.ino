#include <Servo.h>
// CNC demostrativo X/Y con lapicero servo, no GRBL.
const byte STEP_X=2, STEP_Y=3, DIR_X=5, DIR_Y=6, SERVO_PIN=9;
Servo pen;
long xNow=0,yNow=0;
void pulse(byte pin) { digitalWrite(pin,HIGH); delayMicroseconds(1600); digitalWrite(pin,LOW); delayMicroseconds(1600); }
void moveTo(long x,long y) {
  long dx=x-xNow,dy=y-yNow;
  unsigned long ax=labs(dx),ay=labs(dy),n=max(ax,ay);
  if(!n)return;
  digitalWrite(DIR_X,dx>=0?HIGH:LOW);
  digitalWrite(DIR_Y,dy>=0?HIGH:LOW);
  delay(2);
  unsigned long ex=0,ey=0;
  for(unsigned long i=0;i<n;i++) {
    ex+=ax; ey+=ay;
    bool sx=ex>=n,sy=ey>=n;
    if(sx){ex-=n;digitalWrite(STEP_X,HIGH);}
    if(sy){ey-=n;digitalWrite(STEP_Y,HIGH);}
    delayMicroseconds(1600);
    if(sx)digitalWrite(STEP_X,LOW);
    if(sy)digitalWrite(STEP_Y,LOW);
    delayMicroseconds(1600);
  }
  xNow=x;yNow=y;
  Serial.print(F("X="));Serial.print(xNow);Serial.print(F(" Y="));Serial.println(yNow);
}
void penUp(){pen.write(90);delay(250);}
void penDown(){pen.write(40);delay(250);}
void square(){penUp();moveTo(0,0);penDown();moveTo(200,0);moveTo(200,200);moveTo(0,200);moveTo(0,0);penUp();Serial.println(F("CUADRADO TERMINADO"));}
void setup(){
  Serial.begin(115200);Serial.setTimeout(100);
  pinMode(STEP_X,OUTPUT);pinMode(STEP_Y,OUTPUT);
  pinMode(DIR_X,OUTPUT);pinMode(DIR_Y,OUTPUT);
  digitalWrite(STEP_X,LOW);digitalWrite(STEP_Y,LOW);
  pen.attach(SERVO_PIN);penUp();
  Serial.println(F("CNC SIMULADO CORREGIDO: prueba X+ e Y+"));
  moveTo(200,0);delay(500);moveTo(200,200);delay(500);
  moveTo(0,200);delay(500);moveTo(0,0);delay(500);
  square();
  Serial.println(F("COMANDOS: CUADRADO, X200, Y200, HOME, ARRIBA, ABAJO"));
}
void loop(){
 if(!Serial.available())return;
 String c=Serial.readStringUntil('\n');c.trim();c.toUpperCase();
 if(c=="CUADRADO")square();
 else if(c=="HOME"){penUp();moveTo(0,0);}
 else if(c=="ARRIBA")penUp();
 else if(c=="ABAJO")penDown();
 else if(c.startsWith("X"))moveTo(c.substring(1).toInt(),yNow);
 else if(c.startsWith("Y"))moveTo(xNow,c.substring(1).toInt());
 else Serial.println(F("Comando desconocido"));
}
