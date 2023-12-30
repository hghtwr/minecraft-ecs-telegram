import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { McEcsOptions, McEcs } from "./ecs";
import { McLambda, LambdaOptions } from "./lambda";
const config = new pulumi.Config();

const appName = config.require("deploymentId"); // This must be unique in your AWS account


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
    VERSION: config.require("version"),
  }
}

const mcEcs = new McEcs(appName, mcEcsOptions, {});

const mcTelegramBotOptions: LambdaOptions = {
  readinessLogGroup: mcEcs.ecsLogGroup.name.apply(name => name),
  ecsClusterName: mcEcs.cluster.name.apply(name => name),
  ecsServiceName: mcEcs.service.name.apply(name => name),
}


const mcTelegramBot = new McLambda(appName, mcTelegramBotOptions, {dependsOn: [mcEcs]});

pulumi.log.info("Use the telegram API to register the function URL as webhook");
export const functionUrl = mcTelegramBot.commandHandlerFunctionUrl.functionUrl;
