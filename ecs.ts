

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";
const lodash = require('lodash');

interface McEcsOptions {

  image?: string;
  cpu?: number;
  memory?: number;
  azName?: string; // Selected randomly if not specified,
  useSpotInstance?: boolean;
  serverProperties: {
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
  }
}

class McEcs extends pulumi.ComponentResource {

  private readonly azName: Promise<string>;
  private readonly accountId: Promise<string>;
  private readonly subnetIds: Promise<string[]>;
  private readonly subnet: Promise<aws.ec2.GetSubnetResult>;
  private readonly region: Promise<string>;
  public readonly mcEcsOptions: McEcsOptions;

  public readonly ecsLogGroup: aws.cloudwatch.LogGroup;
  private readonly taskRole: aws.iam.Role;

  private readonly efs: aws.efs.FileSystem;
  private readonly accessPoint: aws.efs.AccessPoint;
  private readonly mountTarget: aws.efs.MountTarget;
  private readonly efsBackupPolicy: aws.efs.BackupPolicy;
  private readonly DataSyncEfsLocation: aws.datasync.EfsLocation;
  private readonly DataSyncS3Location: aws.datasync.S3Location;
  private readonly DataSyncTask: aws.datasync.Task;
  private readonly DataSyncS3Bucket: aws.s3.Bucket;
  private readonly DataSyncS3BucketIamRole: aws.iam.Role;
  private readonly DataSyncLogGroup: aws.cloudwatch.LogGroup;

  private readonly securityGroup: aws.ec2.SecurityGroup;
  private readonly securityGroupEgressRule: aws.vpc.SecurityGroupEgressRule;
  private readonly securityGroupIngressRules: aws.vpc.SecurityGroupIngressRule[];

  public readonly cluster: aws.ecs.Cluster;
  private readonly taskDefinition: aws.ecs.TaskDefinition;
  public  readonly service: aws.ecs.Service;


  constructor(name: string, args: McEcsOptions, opts: any) {
        super("awsmc:ecs:" + name, name, args, opts);
        this.azName = aws.getAvailabilityZones({}).then(zones => zones.names[0]);
        this.region = aws.getRegion({}).then(region => region.name);
        this.accountId = aws.getCallerIdentity({}).then(identity => identity.accountId);
        this.subnetIds = this.azName.then(azName => aws.ec2.getSubnets({
          filters: [
            {
              name: "availability-zone",
              values: [azName]
            },
          ]
        }, { async: true }).then((subnets) => subnets.ids));

        this.subnet = this.subnetIds.then(subnets => aws.ec2.getSubnet({
          id: subnets[0]
        }));

        let defaultOptions: McEcsOptions = {
          image: "itzg/minecraft-server",
          cpu: 256,
          memory: 512,
          useSpotInstance: false,
          serverProperties: {
            MODT: "Welcome to Minecraft",
            DIFFICULTY: "normal",
            GAME_MODE: "survival",
            ONLINE_MODE: "TRUE",
            SERVER_NAME: "Minecraft Server",
          }
        };

        this.mcEcsOptions = lodash.merge(defaultOptions, args);
        console.log(this.mcEcsOptions);

        this.efs = new aws.efs.FileSystem("efs", {
          encrypted: true,
          availabilityZoneName: this.azName, // Only one AZ because it's cheaper
          performanceMode: "generalPurpose",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.efsBackupPolicy =  new aws.efs.BackupPolicy("efs-backup-policy", {
          fileSystemId: this.efs.id,
          backupPolicy: {
            status: "ENABLED"
          }
        }, {parent: this, dependsOn: [this.efs]});

        this.accessPoint = new aws.efs.AccessPoint("efs-ap", {
          fileSystemId: this.efs.id,
          posixUser: {
            gid: 1000,
            uid: 1000,
          },
          rootDirectory: {
            creationInfo: {
              ownerGid: 1000,
              ownerUid: 1000,
              permissions: "777",
            },
            path: "/minecraft",
          },
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.taskRole = new aws.iam.Role("taskrole", {
          assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Action: "sts:AssumeRole",
                Principal: {
                  Service: "ecs-tasks.amazonaws.com",
                },
                Effect: "Allow",
                Sid: "",
              },
            ],
          }),
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          description: "Role for ECS task running mincecraft server",
          namePrefix: "mc-taskrole-",
          inlinePolicies: [{
            name: "mc-taskrole-efs",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Action: [
                    "elasticfilesystem:ClientMount",
                    "elasticfilesystem:ClientWrite",
                    "elasticfilesystem:DescribeFileSystems",
                    "elasticfilesystem:backup",
                    "elasticfilesystem:restore",

                  ],
                  Effect: "Allow",
                  Resource: this.efs.arn,
                  Condition: {
                    "StringEquals": {
                      "elasticfilesystem:AccessPointArn": this.accessPoint.arn
                    }
                  }
                }
              ]
            })
          },
          {
            name: "mc-taskrole-cloudwatch",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                  ],
                  Effect: "Allow",
                  Resource: pulumi.interpolate `arn:aws:logs:${this.region}:${this.accountId}:log-group:${name}*`,
                }
              ]
            })
          }]
        }, {parent: this, dependsOn: [ this.accessPoint]});

        this.ecsLogGroup = new aws.cloudwatch.LogGroup("ecs-log-group", {
          namePrefix: name + "-",
          retentionInDays: 7,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.taskDefinition = new aws.ecs.TaskDefinition("taskdefinition", {
          family: name,
          taskRoleArn: this.taskRole.arn,
          executionRoleArn: this.taskRole.arn,
          containerDefinitions: pulumi.jsonStringify([
            {
              name: name,
              image: this.mcEcsOptions.image,
              memory: this.mcEcsOptions.memory,
              portMappings: [
                {
                  containerPort: 25565,
                  hostPort: 25565,
                  protocol: "tcp",
                },
              ],
              logConfiguration: {
                logDriver: "awslogs",
                options: {
                    "awslogs-group": this.ecsLogGroup.name,
                    "awslogs-region": this.region,
                    "awslogs-stream-prefix": name
                }
            },
              mountPoints: [
                {
                  containerPath: "/data",
                  sourceVolume: "minecraft",
                },
              ],
              environment: [
                {
                  name: "EULA",
                  value: "TRUE",
                },
                {
                  name: "MEMORY",
                  //value: `${this.mcEcsOptions.memory}M`
                  value: '' // let it be calculated by the container
                },
                {
                  name: "JVM_XX_OPTS",
                  value: "-XX:MaxRAMPercentage=75"
                },
                {
                  name: "USE_AIKAR_FLAGS",
                  value: "true"
                },
                {
                  name: "RCON_PASSWORD",
                  value: new random.RandomPassword("rcon-password", {length: 16}, {parent: this}).result,
                },
                ...this.buildEnvVars()],
              essential: true,

            },
          ]),
          requiresCompatibilities: ["FARGATE"],
          cpu: `${this.mcEcsOptions.cpu}`,
          memory: `${this.mcEcsOptions.memory}`,
          networkMode: "awsvpc",
          runtimePlatform: {
            operatingSystemFamily: "LINUX",
            cpuArchitecture: this.mcEcsOptions.useSpotInstance ? "X86_64": "ARM64", // Graviton is cheaper but only available for non-spot instances
          },
          volumes: [{
            name: "minecraft",
            efsVolumeConfiguration: {
              fileSystemId: this.efs.id,
              transitEncryption: "ENABLED",
              authorizationConfig: {
                accessPointId: this.accessPoint.id,
                iam: "ENABLED",
              },
            },

          }],
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this, dependsOn: [this.accessPoint, this.ecsLogGroup, this.efs, this.taskRole]});

        this.cluster = new aws.ecs.Cluster("cluster", {
          name: name,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.securityGroup = new aws.ec2.SecurityGroup("securitygroup", {
          description: "Allow inbound port 25565, outbound all",
          namePrefix: "mc-ecs-sg",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});


        const securityGroupIngressRules = [{
          securityGroupId: this.securityGroup.id,
          ipProtocol: "tcp",
          fromPort: 25575,
          toPort: 25575,
          cidrIpv4: "0.0.0.0/0",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        },{
          securityGroupId: this.securityGroup.id,
          ipProtocol: "tcp",
          fromPort: 25565,
          toPort: 25565,
          cidrIpv4: "0.0.0.0/0",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        },{
          securityGroupId: this.securityGroup.id,
          ipProtocol: "tcp",
          fromPort: 2049,
          toPort: 2049,
          cidrIpv4: aws.ec2.getVpc({}).then(vpc => vpc.cidrBlock),
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        }];

        this.securityGroupIngressRules = securityGroupIngressRules.map((rule, index) => {
          return new aws.vpc.SecurityGroupIngressRule(`securitygroupingressrule-${index}`, rule, {parent: this, dependsOn: [this.securityGroup]});
        });


        this.securityGroupEgressRule = new aws.vpc.SecurityGroupEgressRule("securitygroupegressrule", {
          securityGroupId: this.securityGroup.id,
          ipProtocol: "-1",
          cidrIpv4: "0.0.0.0/0",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        },{parent: this, dependsOn: [this.securityGroup]});

        this.mountTarget = new aws.efs.MountTarget("mounttarget", {
          fileSystemId: this.efs.id,
          subnetId: this.subnetIds.then(subnets => subnets[0]),
          securityGroups: [this.securityGroup.id],
        }, {parent: this, deleteBeforeReplace: true});


        this.DataSyncS3Bucket = new aws.s3.Bucket("datasync-s3-bucket", {
          bucketPrefix: name + "-",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        }, {parent: this});

        this.DataSyncS3BucketIamRole = new aws.iam.Role("datasync-s3-role", {
          namePrefix: "datasync-s3-role-",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          inlinePolicies: [{
            name: "datasync-s3-cloudwatch",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                  ],
                  Effect: "Allow",
                  Resource: pulumi.interpolate `arn:aws:logs:${this.region}:${this.accountId}:log-group:${name}-datasync*`,
                }
              ]
            })
          },{
            name: "datasync-s3-role-policy",
            policy: pulumi.jsonStringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: [
                            "s3:GetBucketLocation",
                            "s3:ListBucket",
                            "s3:ListBucketMultipartUploads"
                        ],
                        Effect: "Allow",
                        Resource: this.DataSyncS3Bucket.arn
                    },
                    {
                        Action: [
                            "s3:AbortMultipartUpload",
                            "s3:DeleteObject",
                            "s3:GetObject",
                            "s3:ListMultipartUploadParts",
                            "s3:PutObjectTagging",
                            "s3:GetObjectTagging",
                            "s3:PutObject"
                        ],
                        Effect: "Allow",
                        Resource: pulumi.interpolate `${this.DataSyncS3Bucket.arn}/*`
                    }
                ]
          })
        }],
          assumeRolePolicy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
              {
                Action: "sts:AssumeRole",
                Principal: {
                  Service: "datasync.amazonaws.com",
                },
                Effect: "Allow",
                Condition: {
                  "StringEquals": {
                    "aws:SourceAccount": this.accountId,
                  },
                  "ArnLike": {
                    "aws:SourceArn": pulumi.interpolate `arn:aws:datasync:${this.region}:${this.accountId}:*`
                  }
                }
              },
            ],
          }),
        }, {parent: this, dependsOn: [this.DataSyncS3Bucket]});

        this.DataSyncEfsLocation = new aws.datasync.EfsLocation("datasync-efs-location", {
          ec2Config: {
            securityGroupArns: [this.securityGroup.arn],
            subnetArn: this.subnet.then(subnet => subnet.arn),
          },
          efsFileSystemArn: this.efs.arn,
          subdirectory: "/",
          accessPointArn: this.accessPoint.arn,
          inTransitEncryption: "TLS1_2",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        }, {parent: this, dependsOn: [this.mountTarget]});

        this.DataSyncS3Location = new aws.datasync.S3Location("datasync-s3-location", {
          s3BucketArn: this.DataSyncS3Bucket.arn,
          s3Config: {
            bucketAccessRoleArn: this.DataSyncS3BucketIamRole.arn,
          },
          subdirectory: "/",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        }, {parent: this, dependsOn: [this.mountTarget]});

        this.DataSyncLogGroup = new aws.cloudwatch.LogGroup("datasync-log-group", {
          namePrefix: name + "-datasync-",
          retentionInDays: 7,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.DataSyncTask = new aws.datasync.Task("datasync-task-efs-to-s3", {
          name: "datasync-task-efs-to-s3",
          destinationLocationArn: this.DataSyncS3Location.arn,
          sourceLocationArn: this.DataSyncEfsLocation.arn,
          cloudwatchLogGroupArn: this.DataSyncLogGroup.arn,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          options: {
            logLevel: "BASIC",
            transferMode: "CHANGED",
            posixPermissions: "PRESERVE", // Do not preserve permissions.
          }
        }, {parent: this, dependsOn: [this.DataSyncEfsLocation, this.DataSyncS3Location, this.mountTarget]});

        this.DataSyncTask = new aws.datasync.Task("datasync-task-s3-to-efs", {
          name: "datasync-task-s3-to-efs",
          destinationLocationArn: this.DataSyncEfsLocation.arn,
          sourceLocationArn: this.DataSyncS3Location.arn,
          cloudwatchLogGroupArn: this.DataSyncLogGroup.arn,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          options: {
            logLevel: "BASIC",
            transferMode: "CHANGED",
            posixPermissions: "NONE", // Do not preserve permissions.
            uid: "NONE",              // Do not preserve the user ID of the file owner.
            gid: "NONE",              // Do not preserve the group ID of the file owner.
            preserveDeletedFiles: "REMOVE"
          }
        }, {parent: this, dependsOn: [this.DataSyncEfsLocation, this.DataSyncS3Location, this.mountTarget]});

        const capacityProvider = this.mcEcsOptions.useSpotInstance ? {
          capacityProvider: "FARGATE_SPOT",
          weight: 1,
          base: 0,
        } : {
          capacityProvider: "FARGATE",
          weight: 1,
          base: 1,
        };

        this.service = new aws.ecs.Service(name, {
          cluster: this.cluster.arn,
          desiredCount: 1,
          // launchType: "FARGATE", not allowed because we set capacityProviderStrategies
          taskDefinition: this.taskDefinition.arn,
          capacityProviderStrategies: [capacityProvider],
          networkConfiguration: {
            subnets: this.subnetIds,
            assignPublicIp: true,
            securityGroups: [this.securityGroup.id],
          },
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this,  dependsOn: [this.securityGroupEgressRule, this.mountTarget, this.taskRole, this.cluster, this.taskDefinition] });
      }

      buildEnvVars() {
      let envVars = [];
      for (const [key, value] of Object.entries(this.mcEcsOptions.serverProperties)) {
        envVars.push({
          name: key,
          value: value,
        });
      }
      return envVars;
    }
  }


export { McEcs, McEcsOptions };