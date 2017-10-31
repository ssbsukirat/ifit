// Angular
import { Component } from '@angular/core';

// Rxjs
import { Subscription } from 'rxjs/Subscription';

// Ionic
import {
  ActionSheetController,
  AlertController,
  IonicPage,
  Loading,
  LoadingController,
  Modal,
  ModalController,
  NavController,
  Popover,
  PopoverController
} from 'ionic-angular';
import { IPedometerData } from '@ionic-native/pedometer';

// Firebase
import { AngularFireAuth } from 'angularfire2/auth';
import * as firebase from 'firebase/app';

// Third-party
import * as moment from 'moment';

// Models
import { ActivityType, ActivityPlan, ExerciseGoals, ExerciseLog, ILineChartEntry } from '../../models';

// Providers
import { ActivityProvider } from '../../providers';

@IonicPage({
  name: 'exercise'
})
@Component({
  templateUrl: 'exercise.html',
})
export class ExercisePage {
  private _authId: string;
  private _authSubscription: Subscription;
  private _activitySubscription: Subscription;
  private _exerciseGoalSubscription: Subscription;
  private _getMovingSubscription: Subscription;
  private _loader: Loading;
  private _notificationId: number;
  private _weekLogSubscription: Subscription;
  private _weekLog: ExerciseLog[] = [];
  public activityPlan: ActivityPlan = new ActivityPlan();
  public chartData: ILineChartEntry[] = [];
  public chartDataSelection: string = 'duration';
  public chartLabels: string[] = [];
  public chartOpts: any = { responsive: true };
  public countdown: string = '00:00:00';
  public exerciseGoals: ExerciseGoals = new ExerciseGoals();
  public exerciseSegment: string = 'goals';
  public scheduledGetMoving: boolean = false;
  constructor(
    private _actionSheetCtrl: ActionSheetController,
    private _afAuth: AngularFireAuth,
    private _alertCtrl: AlertController,
    private _activityPvd: ActivityProvider,
    private _loadCtrl: LoadingController,
    private _modalCtrl: ModalController,
    private _navCtrl: NavController,
    private _popoverCtrl: PopoverController
  ) { }

  private _addActivity(): void {
    const activityListModal: Modal = this._modalCtrl.create('activity-list', {
      authId: this._authId
    });
    activityListModal.present();
    activityListModal.onDidDismiss((activities: ActivityType[]) => {
      if (!!activities) {
        this.activityPlan.activities = this.activityPlan.activities ? [...this.activityPlan.activities, ...activities] : [...activities];
        this._updateActivityPlan();
      }
    });
  }

  private _changeDuration(activity: ActivityType): void {
    this._alertCtrl.create({
      title: 'Duration',
      subTitle: 'How long did you perform this activity?',
      inputs: [
        {
          name: 'duration',
          placeholder: 'Minutes',
          type: 'number'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Done',
          handler: (data: { duration: string }) => {
            activity.duration = +data.duration;
            this._activityPvd.calculateActivityEnergyConsumption(activity, this._authId)
              .then((energyConsumption: number) => {
                activity.energyConsumption = energyConsumption;
                this._updateActivityPlan();
              })
              .catch((err: Error) => {
                this._alertCtrl.create({
                  title: 'Uhh ohh...',
                  subTitle: 'Something went wrong',
                  message: err.toString(),
                  buttons: ['OK']
                }).present();
              });
          }
        }
      ]
    }).present();
  }

  private _recordWalking(): void {
    const pedometerModal: Modal = this._modalCtrl.create('pedometer');
    pedometerModal.present();
    pedometerModal.onDidDismiss((pedometerData: IPedometerData) => {
      if (!!pedometerData) {
        this.activityPlan.distanceWalked = pedometerData.distance || 0;
        this.activityPlan.stepsWalked = pedometerData.numberOfSteps || 0;
      }
    });
  }

  private _removeActivity(idx: number): void {
    this.activityPlan.activities = [...this.activityPlan.activities.slice(0, idx), ...this.activityPlan.activities.slice(idx + 1)];
    this._updateActivityPlan();
  }

  private _updateActivityPlan(): void {
    this.activityPlan.totalDuration = this._activityPvd.calculateActivityPlanDuration(this.activityPlan.activities);
    this.activityPlan.totalEnergyConsumption = this._activityPvd.calculateActivityPlanEnergyConsumption(this.activityPlan.activities);
    this.activityPlan.combos.goalsAchieved = this._activityPvd.checkGoalAchievements(this.exerciseGoals, this.activityPlan);
    this.activityPlan.combos.hiit = this._activityPvd.checkHiit(this.activityPlan.activities);
    this.activityPlan.combos.lowActivity = this._activityPvd.checkLowActivity(this.activityPlan.activities);
    this.activityPlan.combos.overtraining = this._activityPvd.checkOvertraining(this.activityPlan.activities);
    this.activityPlan.combos.sedentarism = this._activityPvd.checkSedentarism(this.activityPlan);
    this.activityPlan.lifePoints = this._activityPvd.checkLifePoints(this.activityPlan);
  }

  public cancelMovingSchedule(): void {
    this._getMovingSubscription.unsubscribe();
    this._activityPvd.cancelSchedule();
    this.countdown = '00:00:00';
  }

  public changeActivity(idx: number): void {
    this._actionSheetCtrl.create({
      title: 'Change activity',
      buttons: [
        {
          text: 'Change duration',
          handler: () => {
            this._changeDuration(this.activityPlan.activities[idx]);
          }
        }, {
          text: 'Remove activity',
          handler: () => {
            this._removeActivity(idx);
          }
        }, {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    }).present();
  }

  public changeChartData(): void {
    switch (this.chartDataSelection) {
      case 'duration':
        this.chartData = [{
          data: [...this._weekLog.map((log: ExerciseLog) => log.totalDuration)],
          label: 'Total duration'
        }];
        break;

      case 'energy':
        this.chartData = [{
          data: [...this._weekLog.map((log: ExerciseLog) => log.totalEnergyConsumption)],
          label: 'Total energy consumption'
        }];
        break;


      default:
        break;
    }
  }

  public getPrevPlan(): void {
    this._alertCtrl.create({
      title: 'Copy yesterday activities?',
      buttons: [{
        text: 'Yes',
        handler: () => {
          this._loader = this._loadCtrl.create({
            content: 'Please wait...',
            duration: 30000,
            spinner: 'crescent'
          });
          this._loader.present();
          const subscription: Subscription = this._activityPvd.getPrevActivityPlan$(this._authId).subscribe(
            (activityPlan: ActivityPlan) => {
              this.activityPlan = Object.assign({}, activityPlan['$value'] === null ? this.activityPlan : activityPlan);
              if (this._loader) {
                this._loader.dismiss();
                this._loader = null;
              }
              subscription.unsubscribe();
            },
            (err: firebase.FirebaseError) => {
              if (this._loader) {
                this._loader.dismiss();
                this._loader = null;
              }
              this._alertCtrl.create({
                title: 'Uhh ohh...',
                subTitle: 'Something went wrong',
                message: err.message,
                buttons: ['OK']
              }).present();
            }
          );
        }
      }, {
        text: 'No'
      }]
    }).present();
  }

  public logActivity(): void {
    this._actionSheetCtrl.create({
      title: 'Log activity',
      buttons: [
        {
          text: 'Add existing activity',
          handler: () => {
            this._addActivity();
          }
        }, {
          text: 'Start walking',
          handler: () => {
            this._recordWalking();
          }
        }, {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    }).present();
  }

  public saveActivityPlan(): void {
    this._updateActivityPlan();
    this._loader = this._loadCtrl.create({
      content: 'Please wait...',
      duration: 30000,
      spinner: 'crescent'
    });
    this._loader.present();
    Promise.all([
      this._activityPvd.saveExerciseGoals(this._authId, this.exerciseGoals),
      this._activityPvd.saveActivityPlan(this._authId, this.activityPlan, this._weekLog)
    ]).then(() => {
      if (this._loader) {
        this._loader.dismiss();
        this._loader = null;
      }
      this._alertCtrl.create({
        title: 'Success!',
        message: 'Activity plan saved successfully!',
        buttons: [{
          text: 'Great!',
          handler: () => {
            const goodExercise: boolean = this._activityPvd.checkGoodExercise(this.activityPlan);

            if (goodExercise || this.activityPlan.combos.goalsAchieved) {
              this._modalCtrl.create('rewards', {
                context: 'exercise',
                goalsAchieved: this.activityPlan.combos.goalsAchieved,
                goodQuality: goodExercise,
                lifepoints: this.activityPlan.lifePoints
              }).present();
            }
          }
        }]
      }).present();
    })
      .catch((err: Error) => {
        if (this._loader) {
          this._loader.dismiss();
          this._loader = null;
        }
        this._alertCtrl.create({
          title: 'Uhh ohh...',
          subTitle: 'Something went wrong',
          message: err.toString(),
          buttons: ['OK']
        }).present();
      });
  }

  public showSettings(event: Popover): void {
    const popover: Popover = this._popoverCtrl.create('settings');
    popover.present({
      ev: event
    });
  }

  public startMovingSchedule(): void {
    this.scheduledGetMoving = true;
    this._getMovingSubscription = this._activityPvd.setSchedule(+this.exerciseGoals.getMoving.value).subscribe(timeRemained => {
      if (timeRemained === 0) {
        this._alertCtrl.create({
          title: 'Time is up',
          message: 'Time to get moving',
          buttons: ['OK']
        }).present();
        this._getMovingSubscription.unsubscribe();
        this._getMovingSubscription = null;
        this.scheduledGetMoving = false;
      } else {
        let timeSpent = moment.duration(timeRemained, 'milliseconds');
        this.countdown = `${timeSpent.hours()}:${timeSpent.minutes()}:${timeSpent.seconds()}`;
      }
    });
  }

  ionViewCanEnter(): void {
    this._authSubscription = this._afAuth.authState.subscribe((auth: firebase.User) => {
      if (!auth) {
        if (this._loader) {
          this._loader.dismiss();
          this._loader = null;
        }
        this._navCtrl.setRoot('registration', {
          history: 'exercise'
        });
      };
    })
  }

  ionViewWillEnter(): void {
    this._loader = this._loadCtrl.create({
      content: 'Loading...',
      duration: 30000,
      spinner: 'crescent'
    });
    this._loader.present();
    this._authSubscription = this._afAuth.authState.subscribe((auth: firebase.User) => {
      if (!!auth) {
        this._authId = auth.uid;

        // Subscribe to exercise goals
        this._exerciseGoalSubscription = this._activityPvd.getExerciseGoals$(this._authId).subscribe(
          (goals: ExerciseGoals) => {
            this.exerciseGoals = Object.assign({}, goals['$value'] === null ? this.exerciseGoals : goals);
            if (this.exerciseGoals.getMoving.isSelected && this._activityPvd.notificationScheduled()) {
              this.startMovingSchedule();
            }
          },
          (err: firebase.FirebaseError) => {
            if (this._loader) {
              this._loader.dismiss();
              this._loader = null;
            }
            this._alertCtrl.create({
              title: 'Uhh ohh...',
              subTitle: 'Something went wrong',
              message: err.message,
              buttons: ['OK']
            }).present();
          }
        );

        // Subscribe to activity plan
        this._activitySubscription = this._activityPvd.getActivityPlan$(this._authId).subscribe(
          (activityPlan: ActivityPlan) => {
            this.activityPlan = Object.assign({}, activityPlan['$value'] === null ? this.activityPlan : activityPlan);
            if (this._loader) {
              this._loader.dismiss();
              this._loader = null;
            }
          },
          (err: firebase.FirebaseError) => {
            if (this._loader) {
              this._loader.dismiss();
              this._loader = null;
            }
            this._alertCtrl.create({
              title: 'Uhh ohh...',
              subTitle: 'Something went wrong',
              message: err.message,
              buttons: ['OK']
            }).present();
          }
        );

        // Subscribe to the last 7 days activity plans
        this._weekLogSubscription = this._activityPvd.getExerciseLog$(this._authId).subscribe(
          (weekLog: ExerciseLog[] = []) => {
            this.chartLabels = [...weekLog.map((log: ExerciseLog) => log.date)];
            this._weekLog = [...weekLog];
            this.chartData = [{
              data: [...this._weekLog.map((log: ExerciseLog) => log.totalDuration)],
              label: 'Total duration'
            }];
          },
          (err: firebase.FirebaseError) => {
            this._alertCtrl.create({
              title: 'Uhh ohh...',
              subTitle: 'Something went wrong',
              message: err.message,
              buttons: ['OK']
            }).present();
          }
        );
      }
    });
  }

  ionViewWillLeave(): void {
    this._authSubscription && this._authSubscription.unsubscribe();
    this._activitySubscription && this._activitySubscription.unsubscribe();
    this._exerciseGoalSubscription && this._exerciseGoalSubscription.unsubscribe();
    this._getMovingSubscription && this._getMovingSubscription.unsubscribe();
    this._weekLogSubscription && this._weekLogSubscription.unsubscribe();
    if (this._loader) {
      this._loader.dismiss();
      this._loader = null;
    }
  }
}
