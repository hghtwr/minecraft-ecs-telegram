This project allows you to run as many Minecraft server instances on [AWS ECS Fargate](https://docs.aws.amazon.com/ecs/) (Elastic Container Service) as you like. You can interact with these instances using a [Telegram Chat Bot](https://telegram.org/) hosted serverless on [AWS Lambda](https://aws.amazon.com/lambda/) to start and stop your Minecraft server.

Using IaC (Infrastructure-as-code) by [Pulumi](https://pulumi.com) all you need is to run 1 command from your command line and everything is created automatically. Same goes for removal of the resources: You can remove everything by one simple command after you are done with your server.

🔥 Run as many Minecraft server instances with individual configuration as you can afford

☁️ Hosted on AWS

🤖 Start and stop your servers using a serverless Telegram Chat Bot

📂 Use S3 Datasync to interact with files in your server instance.

💰 Optionally: Use Fargate Spot instances to save up to 70% compared to regular ECS Fargate Deployment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Configuration](#configuration)

# Prerequisites

1. You have an [AWS Account](https://aws.amazon.de) available
2. Your CLI session is authorized to this AWS Account ([How-To](https://docs.aws.amazon.com/signin/latest/userguide/command-line-sign-in.html)).
3. You have installed [Pulumi](https://pulumi.com) on your machine.
4. You have cloned this git repository to your machine.
5. You have
   - [created a Telegram Bot](https://core.telegram.org/bots/tutorial) and saved it's **Bot Token**.
   - Added this bot to a Telegram Group and extracted the chat id using [GetUpdates](https://core.telegram.org/bots/api#getupdates) on the Telegram API

# Quickstart

To quickly get started with this project, follow these steps:

1. Clone the repository:

```sh
git clone https://github.com/hghtwr/minecraft-ecs-telegram.git
cd minecraft-ecs-telegram
```

2. Set the required environment variables:

```sh
export TELEGRAM_API_TOKEN=<Telegram BOT Token>
export TELEGRAM_CHAT_ID=<Telegram chat id>
```

3. Install the Pulumi dependencies:

```sh
npm install
```

4. Deploy the infrastructure using Pulumi:

```sh
pulumi up
```

After Pulumi is done with deployment, it will output the function Url of your Lambda Command Handler.
Set this as a [Webhook](https://core.telegram.org/bots/api#setwebhook) in Telegram

Now you can start and stop your Minecraft server instances using the Telegram Chat Bot hosted on AWS Lambda:

- _/start_: Scales the server instances for this service to 1. Will print the IP of the server once it's ready to accept connections.
- _/stop_: Scales the server instance to 0. Will notify you once the server is shutdown.
- _/status_: Will print the IP of the server given it's up and running.

# Configuration

Customization of your servers is possible using the stack files in the repository (Pulumi.<env>.yaml).
You need to provide a unique `awsmc:deploymentId` for each stack.

Configuration values are read from the stack file (`Pulumi.<env>.yaml`) in the `index.ts`.
They they are assigned to `McEcsOptions`.
You can define all the different server properties that `McEcsOptions` exposes:

```ts
    MODT?: string;
    DIFFICULTY?: string;
    GAME_MODE?: string;
    ONLINE_MODE?: string;
    SERVER_NAME?: string;
    MAX_PLAYERS?: string;
    VERSION?: string;
    RCON?: string;
    ICON?: string;
    MAX_WORLD_SIZE?: string;
    ALLOW_NETHER?: string;
    ANNOUNCE_PLAYER_ACHIEVEMENTS?: string;
    ENABLE_COMMAND_BLOCK?: string;
    FORCE_GAMEMODE?: string;
    GENERATE_STRUCTURES?: string;
    SNOOPER_ENABLED?: string;
    MAX_BUILD_HEIGHT?: string;
    SPAWN_ANIMALS?: string;
    SPAWN_MONSTERS?: string;
    SPAWN_NPCS?: string;
    VIEW_DISTANCE?: string;
    LEVEL_SEED?: string;
    PVP?: string;
    LEVEL_TYPE?: string;
    RESOURCE_PACK?: string;
    RESOURCE_PACK_SHA1?: string;
    RESOURCE_PACK_ENFORCE?: string;
    LEVEL?: string;
    ALLOW_FLIGHT?: string;
    CUSTOM_SERVER_PROPERTIES?: string;

```

## Example: Create a new instance

1. Copy & Paste the `Pulumi.dev.yaml` file and rename it to `Pulumi.test.yaml`
2. Customize the values to your needs
3. Run `pulumi stack select` and create a new stack named `test`.
4. Run `pulumi up` to create a complete new and independent set of infrastructure for your servers.

## Edit server files

Most of the files can be edited by using the values described above. To fiddle around with the file system the package automatically creates [S3 Datasync](https://aws.amazon.com/datasync/?nc1=h_ls) tasks and an S3 Bucket to shift data around.
Go to S3 DataSync and use the corresponding tasks to copy data from the EFS file system to the S3 bucket and vice versa.

## RCON Usage

You can use RCON on port 25575, a password is automatically created during creation. You can find it in the environment variables of the task definition (I'm too lazy to implement AWS Secrets Manager for this right now, feel free to do so).

# Architecture

![Architecture Diagram](./docs/infrastructure_diagram.drawio.png)

## Contributing

Feel free to open issues and PR's :)

## Acknowledgements

Big shoutout to [Minecraft Docker](https://github.com/itzg/docker-minecraft-server)

## Contact

Provide contact information for support or inquiries.
