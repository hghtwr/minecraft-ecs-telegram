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
    MODT: config.get("modt") || undefined,
    DIFFICULTY: config.require("difficulty") || undefined,
    GAME_MODE: config.get("gameMode") || undefined,
    ONLINE_MODE: config.get("onlineMode"),
    SERVER_NAME: config.get("serverName") || undefined,
    MAX_PLAYERS: config.get("maxPlayers")  || undefined,
    VERSION: config.get("version") || undefined,
    RCON: config.get("rcon") || undefined,
    ICON: config.get("icon") || undefined,
    MAX_WORLD_SIZE: config.get("maxWorldSize") || undefined,
    ALLOW_NETHER: config.get("allowNether") || undefined,
    ANNOUNCE_PLAYER_ACHIEVEMENTS: config.get("announcePlayerAchievements") || undefined,
    ENABLE_COMMAND_BLOCK: config.get("enableCommandBlock") || undefined,
    FORCE_GAMEMODE: config.get("forceGamemode") || undefined,
    GENERATE_STRUCTURES: config.get("generateStructures") || undefined,
    SNOOPER_ENABLED: config.get("snooperEnabled") || undefined,
    MAX_BUILD_HEIGHT: config.get("maxBuildHeight") || undefined,
    SPAWN_ANIMALS: config.get("spawnAnimals") || undefined,
    SPAWN_MONSTERS: config.get("spawnMonsters") || undefined,
    SPAWN_NPCS: config.get("spawnNpcs") || undefined,
    VIEW_DISTANCE: config.get("viewDistance") || undefined,
    LEVEL_SEED: config.get("levelSeed") || undefined,
    PVP: config.get("pvp") || undefined,
    LEVEL_TYPE: config.get("levelType") || undefined,
    RESOURCE_PACK: config.get("resourcePack") || undefined,
    RESOURCE_PACK_SHA1: config.get("resourcePackSha1") || undefined,
    RESOURCE_PACK_ENFORCE: config.get("resourcePackEnforce") || undefined,
    ALLOW_FLIGHT: config.get("allowFlight") || undefined,
    CUSTOM_SERVER_PROPERTIES: config.get("customServerProperties") || undefined,
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
