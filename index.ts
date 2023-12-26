import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { McEcsOptions, McEcs } from "./ecs";

const config = new pulumi.Config();



const mcEcsOptions: McEcsOptions = {
  image: config.require("image"),
  cpu: config.getNumber("cpu"),
  memory: config.getNumber("memory"),
  useSpotInstance: config.requireBoolean("useSpotInstance"),
  serverProperties: {
    GAME_MODE: config.require("gameMode"),
    DIFFICULTY: config.require("difficulty"),
    MODT: config.require("modt"),
    ONLINE_MODE: config.require("onlineMode"),
    SERVER_NAME: config.require("serverName"),
  }
}

console.log(mcEcsOptions);

const mcEcs = new McEcs("mc-ecs", mcEcsOptions, {});

mcEcs.deploy();


