package org.firstinspires.ftc.team2844simple.commands;
import com.vcs.valleylib.core.command.Command;
import com.vcs.valleylib.core.command.Commands;
import org.firstinspires.ftc.team2844simple.subsystems.*;
public class CommandFactory { public static Command intakeAndTransfer(IntakeSubsystem i, TransferSubsystem t) { return Commands.none(); } }
