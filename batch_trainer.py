#!/usr/bin/env python3
import asyncio
import json
import time
import os
import argparse
import numpy as np
import matplotlib.pyplot as plt
import pandas as pd
from datetime import datetime
import tensorflow as tf

# Import the DroneRLInterface class from drone_rl.py
from drone_rl import DroneRLInterface

class BatchTrainer:
    """Run multiple drone training experiments with different hyperparameters."""
    
    def __init__(self):
        # Create a timestamped directory for this batch run
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_dir = f"batch_results_{self.timestamp}"
        os.makedirs(self.log_dir, exist_ok=True)
        
        # Store experiment results
        self.results = []
        
        # Set up visualization
        self.setup_visualization()
    
    def setup_visualization(self):
        """Set up real-time visualization of batch results."""
        plt.ion()  # Enable interactive mode
        self.fig, self.axes = plt.subplots(2, 2, figsize=(15, 10))
        self.fig.suptitle('Batch Training Progress')
        
        # Best reward by experiment
        self.axes[0, 0].set_title('Best Reward by Experiment')
        self.axes[0, 0].set_xlabel('Experiment')
        self.axes[0, 0].set_ylabel('Best Reward')
        self.best_reward_bar = self.axes[0, 0].bar([], [])
        
        # Average reward by experiment
        self.axes[0, 1].set_title('Average Reward by Experiment')
        self.axes[0, 1].set_xlabel('Experiment')
        self.axes[0, 1].set_ylabel('Average Reward')
        self.avg_reward_bar = self.axes[0, 1].bar([], [])
        
        # Learning curves for all experiments
        self.axes[1, 0].set_title('Learning Curves')
        self.axes[1, 0].set_xlabel('Episode')
        self.axes[1, 0].set_ylabel('Reward')
        self.learning_curves = []
        
        # Training time by experiment
        self.axes[1, 1].set_title('Training Time by Experiment')
        self.axes[1, 1].set_xlabel('Experiment')
        self.axes[1, 1].set_ylabel('Time (minutes)')
        self.time_bar = self.axes[1, 1].bar([], [])
        
        plt.tight_layout()
        self.fig.subplots_adjust(top=0.9)
        plt.show(block=False)
    
    def update_visualization(self):
        """Update the visualization with current results."""
        if not self.results or not plt.fignum_exists(self.fig.number):
            return
        
        experiment_ids = [r['experiment_id'] for r in self.results]
        
        # Update best rewards
        best_rewards = [r['best_reward'] for r in self.results]
        self.axes[0, 0].clear()
        self.axes[0, 0].set_title('Best Reward by Experiment')
        self.axes[0, 0].set_xlabel('Experiment')
        self.axes[0, 0].set_ylabel('Best Reward')
        self.best_reward_bar = self.axes[0, 0].bar(experiment_ids, best_rewards)
        if best_rewards:
            self.axes[0, 0].set_ylim(min(best_rewards) - 1, max(best_rewards) + 1)
        
        # Update average rewards
        avg_rewards = [r['avg_reward'] for r in self.results]
        self.axes[0, 1].clear()
        self.axes[0, 1].set_title('Average Reward by Experiment')
        self.axes[0, 1].set_xlabel('Experiment')
        self.axes[0, 1].set_ylabel('Average Reward')
        self.avg_reward_bar = self.axes[0, 1].bar(experiment_ids, avg_rewards)
        if avg_rewards:
            self.axes[0, 1].set_ylim(min(avg_rewards) - 1, max(avg_rewards) + 1)
        
        # Update learning curves
        self.axes[1, 0].clear()
        self.axes[1, 0].set_title('Learning Curves')
        self.axes[1, 0].set_xlabel('Episode')
        self.axes[1, 0].set_ylabel('Reward')
        
        for result in self.results:
            if 'rewards' in result and result['rewards']:
                episodes = range(1, len(result['rewards']) + 1)
                self.axes[1, 0].plot(episodes, result['rewards'], 
                                   label=f"Exp {result['experiment_id']}")
        
        if self.results:
            self.axes[1, 0].legend()
        
        # Update training times
        times = [r['duration'] / 60 for r in self.results]  # Convert to minutes
        self.axes[1, 1].clear()
        self.axes[1, 1].set_title('Training Time by Experiment')
        self.axes[1, 1].set_xlabel('Experiment')
        self.axes[1, 1].set_ylabel('Time (minutes)')
        self.time_bar = self.axes[1, 1].bar(experiment_ids, times)
        
        # Update the figure
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()
    
    async def run_experiment(self, params, experiment_id):
        """Run a single experiment with the given parameters."""
        print(f"\n=== Starting Experiment {experiment_id} ===")
        print(f"Parameters: {params}")
        
        # Create results directory for this experiment
        exp_dir = os.path.join(self.log_dir, f"experiment_{experiment_id}")
        os.makedirs(exp_dir, exist_ok=True)
        
        # Save experiment parameters
        with open(os.path.join(exp_dir, "parameters.json"), "w") as f:
            json.dump(params, f, indent=4)
        
        # Initialize result dictionary
        result = {
            'experiment_id': experiment_id,
            'parameters': params,
            'start_time': time.time(),
            'rewards': [],
            'best_reward': 0,
            'avg_reward': 0,
            'duration': 0
        }
        
        try:
            # Create RL interface
            interface = DroneRLInterface(uri=params.get('uri', 'ws://localhost:8765'))
            
            # Configure agent
            if 'learning_rate' in params:
                interface.agent.learning_rate = params['learning_rate']
                # Recreate optimizer with new learning rate
                interface.agent.model.compile(
                    loss='mse', 
                    optimizer=tf.keras.optimizers.Adam(learning_rate=params['learning_rate'])
                )
                interface.agent.target_model.compile(
                    loss='mse', 
                    optimizer=tf.keras.optimizers.Adam(learning_rate=params['learning_rate'])
                )
            
            if 'gamma' in params:
                interface.agent.gamma = params['gamma']
            
            if 'epsilon_decay' in params:
                interface.agent.epsilon_decay = params['epsilon_decay']
            
            if 'batch_size' in params:
                interface.batch_size = params['batch_size']
            
            # Connect to the simulation
            connected = await interface.connect()
            if not connected:
                print(f"Experiment {experiment_id}: Failed to connect to simulation")
                return None
            
            # Start receiving messages in the background
            receive_task = asyncio.create_task(interface.receive_messages())
            
            # Run training
            episodes = params.get('episodes', 30)
            steps_per_episode = params.get('steps_per_episode', 500)
            
            print(f"Experiment {experiment_id}: Starting training for {episodes} episodes with {steps_per_episode} steps each")
            
            # Run the training
            rewards = await interface.train(episodes=episodes, steps_per_episode=steps_per_episode)
            
            # Calculate results
            result['rewards'] = rewards
            result['best_reward'] = max(rewards) if rewards else 0
            result['avg_reward'] = sum(rewards) / len(rewards) if rewards else 0
            result['duration'] = time.time() - result['start_time']
            
            # Save model
            model_path = os.path.join(exp_dir, "final_model.h5")
            interface.agent.save(model_path)
            result['model_path'] = model_path
            
            # Save rewards
            rewards_path = os.path.join(exp_dir, "rewards.csv")
            pd.DataFrame({'episode': range(1, len(rewards) + 1), 'reward': rewards}).to_csv(
                rewards_path, index=False)
            result['rewards_path'] = rewards_path
            
            # Save reward plot
            plt.figure(figsize=(10, 6))
            plt.plot(rewards)
            plt.title(f'Training Rewards - Experiment {experiment_id}')
            plt.xlabel('Episode')
            plt.ylabel('Total Reward')
            plot_path = os.path.join(exp_dir, "rewards_plot.png")
            plt.savefig(plot_path)
            plt.close()
            result['plot_path'] = plot_path
            
            print(f"Experiment {experiment_id}: Completed successfully")
            print(f"Average reward: {result['avg_reward']:.4f}")
            print(f"Best reward: {result['best_reward']:.4f}")
            print(f"Duration: {result['duration'] / 60:.2f} minutes")
            
            # Clean up
            receive_task.cancel()
            await interface.disconnect()
            
            return result
            
        except Exception as e:
            print(f"Experiment {experiment_id} failed with error: {e}")
            return None
        finally:
            # Always update the duration
            if 'start_time' in result:
                result['duration'] = time.time() - result['start_time']
    
    async def run_batch_experiments(self, experiments):
        """Run a batch of experiments with different parameters."""
        for i, params in enumerate(experiments):
            # Run the experiment
            experiment_id = i + 1
            result = await self.run_experiment(params, experiment_id)
            
            if result:
                # Add to results
                self.results.append(result)
                
                # Update visualization
                self.update_visualization()
                
                # Save current batch results
                self.save_batch_results()
        
        # Final analysis
        self.analyze_results()
    
    def save_batch_results(self):
        """Save the current batch results to file."""
        # Convert to DataFrame
        results_df = pd.DataFrame([
            {
                'experiment_id': r['experiment_id'],
                'learning_rate': r['parameters'].get('learning_rate', 0),
                'gamma': r['parameters'].get('gamma', 0),
                'epsilon_decay': r['parameters'].get('epsilon_decay', 0),
                'batch_size': r['parameters'].get('batch_size', 0),
                'episodes': r['parameters'].get('episodes', 0),
                'steps_per_episode': r['parameters'].get('steps_per_episode', 0),
                'avg_reward': r['avg_reward'],
                'best_reward': r['best_reward'],
                'duration_minutes': r['duration'] / 60
            }
            for r in self.results
        ])
        
        # Save to CSV
        results_path = os.path.join(self.log_dir, "batch_results.csv")
        results_df.to_csv(results_path, index=False)
        
        # Save plots
        plt.figure(figsize=(12, 8))
        for result in self.results:
            if 'rewards' in result and result['rewards']:
                plt.plot(result['rewards'], label=f"Exp {result['experiment_id']}")
        
        plt.title('Learning Curves for All Experiments')
        plt.xlabel('Episode')
        plt.ylabel('Total Reward')
        plt.legend()
        plt.savefig(os.path.join(self.log_dir, "all_learning_curves.png"))
        plt.close()
        
        print(f"Batch results saved to {self.log_dir}")
    
    def analyze_results(self):
        """Analyze batch results to find the best hyperparameters."""
        if not self.results:
            print("No results to analyze")
            return
        
        # Find best experiment by average reward
        best_avg_idx = max(range(len(self.results)), 
                         key=lambda i: self.results[i]['avg_reward'])
        best_avg = self.results[best_avg_idx]
        
        # Find best experiment by best reward
        best_peak_idx = max(range(len(self.results)), 
                          key=lambda i: self.results[i]['best_reward'])
        best_peak = self.results[best_peak_idx]
        
        print("\n=== Batch Training Analysis ===")
        print(f"Total experiments: {len(self.results)}")
        
        print("\nBest experiment by average reward:")
        print(f"Experiment ID: {best_avg['experiment_id']}")
        print(f"Average reward: {best_avg['avg_reward']:.4f}")
        print(f"Parameters: {best_avg['parameters']}")
        
        print("\nBest experiment by peak reward:")
        print(f"Experiment ID: {best_peak['experiment_id']}")
        print(f"Best reward: {best_peak['best_reward']:.4f}")
        print(f"Parameters: {best_peak['parameters']}")
        
        # Create correlation analysis
        results_df = pd.DataFrame([
            {
                'learning_rate': r['parameters'].get('learning_rate', 0),
                'gamma': r['parameters'].get('gamma', 0),
                'epsilon_decay': r['parameters'].get('epsilon_decay', 0),
                'batch_size': r['parameters'].get('batch_size', 0),
                'avg_reward': r['avg_reward'],
                'best_reward': r['best_reward']
            }
            for r in self.results
        ])
        
        # Calculate correlations
        if len(results_df) > 1:  # Need at least 2 experiments for correlation
            correlations = results_df.corr()
            
            print("\nParameter Impact Analysis:")
            print("Correlation with average reward:")
            for param in ['learning_rate', 'gamma', 'epsilon_decay', 'batch_size']:
                if param in correlations.index:
                    corr = correlations.loc[param, 'avg_reward']
                    print(f"{param}: {corr:.4f}")
            
            # Save correlation heatmap
            plt.figure(figsize=(10, 8))
            plt.imshow(correlations.values, cmap='coolwarm', vmin=-1, vmax=1)
            plt.colorbar()
            plt.xticks(range(len(correlations.columns)), correlations.columns, rotation=45)
            plt.yticks(range(len(correlations.index)), correlations.index)
            plt.title('Parameter Correlations')
            for i in range(len(correlations.index)):
                for j in range(len(correlations.columns)):
                    plt.text(j, i, f"{correlations.iloc[i, j]:.2f}", 
                            ha="center", va="center", color="black")
            
            plt.tight_layout()
            plt.savefig(os.path.join(self.log_dir, "parameter_correlations.png"))
            plt.close()
        
        # Save best experiment details
        with open(os.path.join(self.log_dir, "best_experiment.json"), "w") as f:
            json.dump({
                "best_by_average": {
                    "experiment_id": best_avg['experiment_id'],
                    "average_reward": best_avg['avg_reward'],
                    "parameters": best_avg['parameters']
                },
                "best_by_peak": {
                    "experiment_id": best_peak['experiment_id'],
                    "peak_reward": best_peak['best_reward'],
                    "parameters": best_peak['parameters']
                }
            }, f, indent=4)

def generate_experiments(num_experiments=5):
    """Generate experiment configurations with different hyperparameters."""
    base_params = {
        'episodes': 30,
        'steps_per_episode': 500
    }
    
    experiments = []
    
    # Experiment 1: Default parameters
    experiments.append({
        **base_params,
        'learning_rate': 0.001,
        'gamma': 0.95,
        'epsilon_decay': 0.995,
        'batch_size': 64
    })
    
    # Experiment 2: Higher learning rate
    experiments.append({
        **base_params,
        'learning_rate': 0.003,
        'gamma': 0.95,
        'epsilon_decay': 0.995,
        'batch_size': 64
    })
    
    # Experiment 3: Higher discount factor
    experiments.append({
        **base_params,
        'learning_rate': 0.001,
        'gamma': 0.99,
        'epsilon_decay': 0.995,
        'batch_size': 64
    })
    
    # Experiment 4: Slower exploration decay
    experiments.append({
        **base_params,
        'learning_rate': 0.001,
        'gamma': 0.95,
        'epsilon_decay': 0.99,
        'batch_size': 64
    })
    
    # Experiment 5: Larger batch size
    experiments.append({
        **base_params,
        'learning_rate': 0.001,
        'gamma': 0.95,
        'epsilon_decay': 0.995,
        'batch_size': 128
    })
    
    # Additional experiments if requested
    if num_experiments > 5:
        # Generate random hyperparameter combinations
        for i in range(5, num_experiments):
            experiments.append({
                **base_params,
                'learning_rate': np.random.choice([0.0001, 0.0005, 0.001, 0.002, 0.003]),
                'gamma': np.random.choice([0.9, 0.95, 0.97, 0.99]),
                'epsilon_decay': np.random.choice([0.98, 0.985, 0.99, 0.995, 0.998]),
                'batch_size': np.random.choice([32, 64, 128, 256])
            })
    
    return experiments[:num_experiments]

async def main():
    """Main function to run the batch training."""
    parser = argparse.ArgumentParser(description='Run batch training for drone control')
    parser.add_argument('--num-experiments', type=int, default=5, 
                        help='Number of experiments to run')
    parser.add_argument('--custom-config', type=str, default=None,
                        help='Path to custom experiment configuration JSON file')
    
    args = parser.parse_args()
    
    # Initialize trainer
    trainer = BatchTrainer()
    
    # Load experiment configurations
    if args.custom_config and os.path.exists(args.custom_config):
        with open(args.custom_config, 'r') as f:
            try:
                experiments = json.load(f)
                print(f"Loaded {len(experiments)} experiments from {args.custom_config}")
            except json.JSONDecodeError:
                print(f"Error loading experiments from {args.custom_config}. Using default experiments.")
                experiments = generate_experiments(args.num_experiments)
    else:
        # Generate default experiments
        experiments = generate_experiments(args.num_experiments)
    
    print(f"Running {len(experiments)} experiments")
    
    try:
        # Run all experiments
        await trainer.run_batch_experiments(experiments)
        
        print("Batch training completed successfully!")
        print(f"Results saved to {trainer.log_dir}")
        
    except KeyboardInterrupt:
        print("\nBatch training interrupted by user")
        print("Saving partial results...")
        trainer.save_batch_results()
    except Exception as e:
        print(f"Error during batch training: {e}")
    finally:
        # Close all plots
        plt.close('all')

if __name__ == "__main__":
    asyncio.run(main()) 